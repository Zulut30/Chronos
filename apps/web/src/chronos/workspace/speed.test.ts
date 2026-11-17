import { expect, it } from "vite-plus/test";
import { ProviderTurnId } from "@t3tools/contracts";
import { ProviderSpeedSampler, StreamSpeedSampler } from "./speed";

it("excludes idle/tool gaps from streamed text estimates and resets on a different turn", () => {
  const sampler = new StreamSpeedSampler();
  expect(sampler.observe("a", 10, 0)).toBeNull();
  expect(sampler.observe("a", 50, 1000)).toEqual({ tokens: 40, ms: 1000, rate: 40 });
  expect(sampler.observe("a", 70, 11000)).toEqual({ tokens: 40, ms: 1000, rate: 40 });
  expect(sampler.observe("a", 90, 12000)).toEqual({ tokens: 60, ms: 2000, rate: 30 });
  expect(sampler.observe("b", 50, 13000)).toBeNull();
});
it("uses native output-token timestamps for precise samples without treating loaded history as live", () => {
  const sampler = new ProviderSpeedSampler(),
    id = ProviderTurnId.make("provider-sample");
  const turn = (status: "running" | "completed", outputTokens: number, updatedAt: string) => ({
    id,
    status,
    tokenUsage: { usedTokens: outputTokens, outputTokens, updatedAt },
  });
  expect(sampler.observe(turn("completed", 100, "2026-11-17T12:00:00.000Z"))).toBeNull();
  expect(sampler.observe(turn("running", 5, "2026-11-17T12:00:10.000Z"))).toBeNull();
  expect(sampler.observe(turn("completed", 105, "2026-11-17T12:00:12.000Z"))).toEqual({
    tokens: 100,
    ms: 2000,
    key: `chronos:${id}:1794916810000`,
  });
});
