import assert from "node:assert/strict";
import { test } from "node:test";
import { candidatePush, releaseSummary } from "./release-metrics.mjs";
test("release latency starts at the correct integration push; candidate reports leave publication pending", () => {
  const pushedAt="2026-11-26T20:00:00Z", feedAt="2026-11-26T20:05:00Z";
  const build={head_sha:"sha",created_at:"2026-11-26T20:01:00Z"};
  assert.equal(candidatePush([{after:"sha",timestamp:feedAt,activity_type:"push"},
    {after:"other",timestamp:pushedAt,activity_type:"push"},{after:"sha",timestamp:pushedAt,activity_type:"branch_creation"}],build),pushedAt);
  assert.throws(()=>candidatePush([],build));
  assert.match(releaseSummary({pushedAt,feedAt,receivedBytes:123,fallbackReason:"HTTP 501"}),/300 s/);
  assert.match(releaseSummary({pushedAt,feedAt:null}),/pending publication/);
});
