import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { parseUpdateManifest } from "../../../scripts/lib/update-manifest.ts";
import { chronosUpdateFeed } from "../../../scripts/lib/chronos-update-feed.ts";
import { pinWindowsFeed } from "./windows-feed.mjs";
import { cachedInstaller, rehearseUpdate } from "./rehearse-update.mjs";

export function candidatePush(history, build) {
  const push = history.find(e => e.after === build.head_sha && ["push","branch_creation"].includes(e.activity_type)
    && e.timestamp <= build.created_at);
  assert.ok(push, "Cannot find the candidate push for this desktop build");
  return push.timestamp;
}

export function releaseSummary(r) {
  return [`## Windows update вЂ” ${r.mode}`, "", "| Metric | Value |", "|---|---|",
    `| Previous release | ${r.previousTag ?? "first release"} |`, `| Target | ${r.version} (${r.sha}) |`,
    `| Desktop run | ${r.desktopRunId} |`, `| Installer bytes | ${r.fullSize} |`,
    `| Range / blockmap / full-download bytes | ${r.rangeBytes} / ${r.mapBytes} / ${r.fullBytes} |`,
    `| Received bytes | ${r.receivedBytes} |`, `| Full-download reason | ${r.fallbackReason ?? "none"} |`,
    `| Candidate push (UTC) | ${r.pushedAt} |`, `| Public feed observed (UTC) | ${r.feedAt ?? "unpublished candidate"} |`,
    `| Push to public feed | ${r.feedAt ? (Date.parse(r.feedAt)-Date.parse(r.pushedAt))/1000 + " s" : "pending publication"} |`, ""].join("\n");
}

async function openStage(dir, name) {
  const server = createServer(async (req,res) => {
    const file = basename(new URL(req.url, "http://localhost").pathname);
    if (file !== name && file !== name + ".blockmap") { res.writeHead(404).end(); return; }
    try {
      const location = join(dir, file), size = (await stat(location)).size;
      let start = 0, end = size - 1;
      if (req.headers.range) {
        const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
        if (!match || +match[1] > +match[2] || +match[2] >= size) { res.writeHead(416).end(); return; }
        [,start,end] = match.map(Number);
        res.statusCode = 206; res.setHeader("content-range", `bytes ${start}-${end}/${size}`);
      }
      res.setHeader("content-length", end-start+1);
      if (req.method === "HEAD") res.end(); else await pipeline(createReadStream(location,{ start,end }),res);
    } catch (e) { res.destroy(e); }
  });
  await new Promise((resolve,reject) => server.once("error",reject).listen(0,"127.0.0.1",resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

async function checked(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw Error(`HTTP ${response.status} for ${url}`);
  return response;
}
async function getFeed(url, version) {
  for (let i = 0; i < 10; i++) {
    const response = await fetch(url, { cache: "no-store" });
    if (response.ok) {
      const manifest = parseUpdateManifest(await response.text(), "nightly.yml", "Windows");
      if (manifest.version === version) return manifest;
    } else if (response.status !== 404) throw Error(`Feed HTTP ${response.status}`);
    if (i < 9) await delay(3000);
  }
  throw Error("Public updater feed did not serve the released version");
}

async function main([mode, version, dir, output]) {
  assert.ok(["candidate", "published"].includes(mode));
  const repo = process.env.GITHUB_REPOSITORY, desktopRunId = process.env.DESKTOP_RUN_ID || process.env.GITHUB_RUN_ID;
  const api = async suffix => (await checked(`https://api.github.com/repos/${repo}/${suffix}`,
    { headers: { Authorization: "Bearer " + process.env.GH_TOKEN } })).json();
  const config = chronosUpdateFeed(`https://github.com/${repo}/releases/latest/download`, "nightly");
  const name = `Chronos-${version}-x64.exe`;
  const manifest = mode === "candidate"
    ? parseUpdateManifest(pinWindowsFeed(await readFile(join(dir,"nightly.yml"),"utf8"),version,repo), "nightly.yml", "Windows")
    : await getFeed(config.url + "/nightly.yml",version);
  const feedAt = mode === "published" ? new Date().toISOString() : null;
  const build = await api("actions/runs/" + desktopRunId);
  assert.equal(build.head_sha, process.env.GITHUB_SHA);
  const history = await api("activity?per_page=100&ref="+encodeURIComponent("refs/heads/"+build.head_branch));
  const pushedAt = candidatePush(history,build);
  const releases = await api("releases?per_page=100");
  const current = releases.find(r => r.tag_name === "chronos-v"+version);
  if (mode === "published") assert.ok(current && !current.draft);
  const prior = releases.filter(r => !r.draft && !r.prerelease && r.tag_name.startsWith("chronos-v") &&
      (mode === "candidate" || r.published_at < current.published_at)).sort((a,b)=>b.published_at.localeCompare(a.published_at))[0];
  const work = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(),"update-probe-"));
  let stage;
  try {
    if (mode === "candidate") stage = await openStage(dir,name);
    // A development build can retain the previous version number. Its installed base has a cached map.
    const oldVersion = prior?.tag_name.slice("chronos-v".length) ?? "0.0.0";
    if (prior) {
      const oldName = `Chronos-${oldVersion}-x64.exe`;
      const old = prior.assets.find(a => a.name === oldName);
      assert.ok(old?.digest?.startsWith("sha256:"), "Missing baseline digest");
      const hash = createHash("sha256");
      await pipeline((await checked(old.browser_download_url)).body, async function* (chunks) {
        for await (const chunk of chunks) { hash.update(chunk); yield chunk; }
      }, createWriteStream(join(work,cachedInstaller)));
      assert.equal("sha256:"+hash.digest("hex"),old.digest);
      if (mode === "candidate" && oldVersion === version) {
        const oldMap = prior.assets.find(a => a.name === oldName+".blockmap");
        const bytes = Buffer.from(await (await checked(oldMap.browser_download_url)).arrayBuffer());
        assert.equal("sha256:"+createHash("sha256").update(bytes).digest("hex"),oldMap.digest);
        await writeFile(join(work,"current.blockmap"),bytes);
      }
    }
    const result = await rehearseUpdate({ directory:work,oldVersion,manifest,config,
      resolveUrl: url => stage && basename(url.pathname).startsWith(name) ? new URL(url.pathname,stage.url) : url });
    const record = { mode,version,sha:build.head_sha,desktopRunId,previousTag:prior?.tag_name ?? null,pushedAt,feedAt,...result };
    await writeFile(output,JSON.stringify(record,null,2)+"\n");
    await appendFile(process.env.GITHUB_STEP_SUMMARY,releaseSummary(record));
    console.log(JSON.stringify(record));
  } finally {
    try { if (stage) await stage.close(); } finally { await rm(work,{recursive:true,force:true}); }
  }
}
if (import.meta.main) await main(process.argv.slice(2));
