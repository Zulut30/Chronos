// @effect-diagnostics nodeBuiltinImport:off -- The fixture checks a real Windows directory junction and temporary-home cleanup.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import { parseQuota, readNativeQuota } from "./quota.ts";

const group = {
  name: "Gemini Models",
  buckets: [
    { id: "gemini-5h", name: "Five Hour Limit Remaining", window: "5h", remaining_fraction: 0.75 },
    {
      id: "gemini-weekly",
      name: "Weekly Limit Remaining",
      window: "weekly",
      remaining_fraction: 0,
      reset_time: "2026-11-30T10:00:00Z",
    },
  ],
};
const report = {
  status: "SUCCESS",
  num_turns: 0,
  command: {
    name: "usage",
    data: {
      groups: [
        group,
        {
          name: "Claude and GPT models",
          buckets: [
            { id: "3p-5h", name: "Five Hour Limit Remaining", window: "5h", remaining_fraction: 1 },
            {
              id: "3p-weekly",
              name: "Weekly Limit Remaining",
              window: "weekly",
              remaining_fraction: 0.5,
            },
          ],
        },
      ],
    },
  },
};

it("maps the CLI's remaining fractions and reset times without inferring missing limits", () => {
  expect(parseQuota(JSON.stringify(report))).toEqual([
    {
      id: "gemini-5h",
      kind: "session",
      label: "Gemini · 5-hour",
      modelIds: [],
      usedPercent: 25,
      windowDurationMins: 300,
    },
    {
      id: "gemini-weekly",
      kind: "weekly",
      label: "Gemini · Weekly",
      modelIds: [],
      usedPercent: 100,
      windowDurationMins: 10080,
      resetsAt: "2026-11-30T10:00:00.000Z",
    },
    {
      id: "3p-5h",
      kind: "session",
      label: "Claude & GPT (shared) · 5-hour",
      modelIds: [],
      usedPercent: 0,
      windowDurationMins: 300,
    },
    {
      id: "3p-weekly",
      kind: "weekly",
      label: "Claude & GPT (shared) · Weekly",
      modelIds: [],
      usedPercent: 50,
      windowDurationMins: 10080,
    },
  ]);
  for (const invalid of [
    { ...report, status: "ERROR" },
    { ...report, num_turns: 1 },
    { ...report, command: { name: "usage", data: { groups: [] } } },
    {
      ...report,
      command: {
        name: "usage",
        data: {
          groups: [{ ...group, buckets: [{ id: "weekly", name: "Weekly", window: "weekly" }] }],
        },
      },
    },
  ])
    expect(() => parseQuota(JSON.stringify(invalid))).toThrow();
});

it("only runs native /usage for a supported CLI in the selected account's file store", async () => {
  const profile = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "chronos-quota-test-"));
  const acpDirectory = NodePath.join(profile, "antigravity-acp");
  const marker = "antigravity-oauth-token";
  const input = {
    acpDirectory,
    executable: "selected-agy",
    checkedAt: "2026-11-01T10:00:00Z",
    signal: new AbortController().signal,
    environment: {
      HOME: "/other",
      USERPROFILE: "/other",
      GEMINI_API_KEY: "unrelated",
      AGY_ADC_AUTH: "true",
    },
  };
  const calls: string[][] = [];
  let version = "1.1.10";
  let lastHome = "";
  let output = JSON.stringify(report);
  try {
    const run = async (exe: string, args: string[], home: string, env: NodeJS.ProcessEnv) => {
      calls.push(args);
      lastHome = home;
      expect(exe).toBe(input.executable);
      expect(env).toMatchObject({
        HOME: home,
        USERPROFILE: home,
        SSH_CONNECTION: expect.any(String),
      });
      expect(env.GEMINI_API_KEY).toBeUndefined();
      expect(env.AGY_ADC_AUTH).toBeUndefined();
      const store = NodePath.join(home, ".gemini", "antigravity-cli");
      expect(await NodeFSP.realpath(store)).toBe(await NodeFSP.realpath(acpDirectory));
      return args[0] === "--version" ? version : output;
    };
    expect((await readNativeQuota(input, run)).unavailable?.reason).toBe("unsupported");
    expect(calls).toEqual([]);
    await NodeFSP.mkdir(acpDirectory);
    await NodeFSP.writeFile(NodePath.join(acpDirectory, marker), "synthetic");
    expect((await readNativeQuota(input, run)).unavailable?.reason).toBe("unsupported");
    expect(calls).toEqual([["--version"]]);
    version = "1.5.12";
    expect((await readNativeQuota(input, run)).windows).toHaveLength(4);
    expect(calls.slice(1)).toEqual([["--version"], ["-p", "/usage", "--output-format", "json"]]);
    output = output.replace("2026-11-30T10:00:00Z", "invalid reset");
    expect(await readNativeQuota(input, run)).toMatchObject({
      unavailable: { reason: "probeFailed" },
      windows: [],
    });
    expect(await NodeFSP.stat(NodePath.join(acpDirectory, marker))).toBeDefined();
    await expect(NodeFSP.stat(lastHome)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await NodeFSP.rm(profile, { recursive: true, force: true });
  }
});
