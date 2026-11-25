import { expect, it } from "vite-plus/test";
import { partitionOpenCode } from "./partitionOpenCode.ts";

it("preserves physical identities, missing, partial and empty sources in both buckets", () => {
  const sources = [
    { volumeId: "v", files: [{ path: "mixed", records: [{ provider: "openrouter" }] }] },
    { volumeId: "w", files: null, status: "partial" },
  ];
  expect(partitionOpenCode(sources)).toEqual([
    { volumeId: "v", files: [], provider: "opencode" },
    { ...sources[1], provider: "opencode" },
    { ...sources[0], provider: "openrouter" },
    { ...sources[1], provider: "openrouter" },
  ]);
});
