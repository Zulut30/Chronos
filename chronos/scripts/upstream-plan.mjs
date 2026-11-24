import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const usage =
  "node chronos/scripts/upstream-plan.mjs feature [start-ref] | surface | nightly <ref> | pick <commit>";

function git(args, allowed = [0]) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (!allowed.includes(result.status)) {
    throw new Error(result.stderr.trim() || `git ${args[0]} завершился с кодом ${result.status}`);
  }
  return result;
}

function changed(from, to, filter) {
  const args = ["diff", "--name-only", "--no-renames", "--no-relative", "-z"];
  if (filter) args.push(`--diff-filter=${filter}`);
  return git([...args, from, to, "--"])
    .stdout.split("\0")
    .filter(Boolean);
}

function list(title, paths) {
  console.log(`${title} (${paths.length})`);
  for (const path of paths) console.log("  " + JSON.stringify(path));
}

function commit(ref) {
  return git(["rev-parse", "--verify", "--end-of-options", ref + "^{commit}"]).stdout.trim();
}

function feature(root, ref) {
  const start = git(["merge-base", commit(ref), "HEAD"]).stdout.trim();
  const diff = ["-C", root, "diff", "--no-renames", "--name-only", "-z"];
  const committed = git([...diff, start, "HEAD", "--"]).stdout;
  const staged = git([...diff, "--cached", "HEAD", "--"]).stdout;
  const unstaged = git([...diff, "--"]).stdout;
  const untracked = git(["-C", root, "ls-files", "--others", "--exclude-standard", "-z"]).stdout;
  const own = [];
  const shared = [];
  for (const path of new Set(
    (committed + staged + unstaged + untracked).split("\0").filter(Boolean),
  )) {
    const inChronos = /^(chronos\/|apps\/[^/]+\/src\/chronos\/|\.github\/workflows\/chronos-)/.test(
      path,
    );
    (inChronos ? own : shared).push(path);
  }
  console.log(`Изменения функции от ${start}, включая рабочую копию.`);
  list("В каталогах Chronos", own.sort());
  list("Вне каталогов Chronos — проверьте точки встраивания", shared.sort());
}

function plan(args) {
  if (args.length === 1 && args[0] === "--help") return console.log(usage);
  const [mode, ref] = args;
  const valid =
    (mode === "feature" && args.length <= 2) ||
    (mode === "surface" && args.length === 1) ||
    (["nightly", "pick"].includes(mode) && args.length === 2);
  if (!valid) throw new Error(usage);

  const root = git(["rev-parse", "--show-toplevel"]).stdout.trimEnd();
  if (mode === "feature") return feature(root, ref ?? "HEAD");
  const { upstream, upstreamCommit: base } = JSON.parse(
    readFileSync(resolve(root, "chronos/version.json"), "utf8"),
  );
  if (!/^[0-9a-f]{40}$/.test(base))
    throw new Error("Укажите upstreamCommit в chronos/version.json");
  if (git(["merge-base", "--is-ancestor", base, "HEAD"], [0, 1]).status !== 0) {
    throw new Error("Текущая ветка не содержит базу T3 из chronos/version.json");
  }
  console.log(`База T3: v${upstream} (${base}). Сравнение по коммитам до HEAD.`);
  if (mode === "surface") {
    list("Изменённые и удалённые исходные файлы T3", changed(base, "HEAD", "MDT"));
    return;
  }
  const target = commit(ref);
  if (git(["merge-base", "--is-ancestor", base, target], [0, 1]).status !== 0) {
    throw new Error("Выбранный коммит не продолжает зафиксированную базу T3");
  }
  let from = base;
  if (mode === "pick") {
    const parents = git(["show", "-s", "--format=%P", target]).stdout.trim().split(/\s+/);
    if (parents.length !== 1 || !parents[0])
      throw new Error("Для pick нужен коммит с одним родителем");
    from = parents[0];
  }
  console.log("Цель: " + git(["show", "-s", "--format=%h %s", target]).stdout.trimEnd());
  if (git(["merge-base", "--is-ancestor", target, "HEAD"], [0, 1]).status === 0) {
    console.log("Этот коммит уже входит в историю Chronos.");
    return;
  }
  const fork = new Set(changed(base, "HEAD"));
  const incoming = changed(from, target);
  console.log(`Файлов в изменении T3: ${incoming.length}`);
  list(
    "Пути, изменённые с обеих сторон",
    incoming.filter((path) => fork.has(path)),
  );
  const options = mode === "pick" ? ["--merge-base=" + from] : [];
  const merge = git(
    [
      "merge-tree",
      "--write-tree",
      "--name-only",
      "--no-messages",
      "-z",
      ...options,
      "HEAD",
      target,
    ],
    [0, 1],
  );
  const [tree, ...paths] = merge.stdout.split("\0");
  list("Конфликты при пробном переносе Git", paths.filter(Boolean));
  if (merge.status === 1) return;
  const headTree = git(["rev-parse", "HEAD^{tree}"]).stdout.trim();
  console.log(
    tree === headTree
      ? "Перенос не меняет содержимое HEAD."
      : "Git может совместить изменения автоматически.",
  );
}

try {
  plan(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
