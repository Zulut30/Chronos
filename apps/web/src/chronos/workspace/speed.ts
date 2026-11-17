import { useSyncExternalStore } from "react";
import { readStored, saveStored } from "./state";
import type { OrchestrationV2ProviderTurn } from "@t3tools/contracts";

export interface LegacySpeed {
  m: Record<
    string,
    { d: string; r: number[][]; g: number[][]; t: number[][]; f: number[]; c: number }
  >;
}
export function legacySpeed(model: string): number | null {
  const sample = readStored<LegacySpeed>("oly-speed-v2", { m: {} }).m[model];
  if (!sample) return null;
  const ttft = sample.f.length
    ? sample.f.toSorted((a, b) => a - b)[Math.floor(sample.f.length / 2)]!
    : 1200;
  const rates = [
    ...sample.r.map((x) => [x[0]!, x[1]!]),
    ...sample.g.map((x) => [x[0]!, Math.max(x[1]! - ttft, x[1]! * 0.35)]),
    ...sample.t.map((x) => [x[0]!, Math.max(x[1]! - x[2]! * ttft, x[1]! * 0.35)]),
  ]
    .filter(([tokens, ms]) => tokens! > 0 && ms! > 0)
    .map(([tokens, ms]) => (tokens! / ms!) * 1000)
    .filter((n) => n > 0.5 && n < 5000)
    .sort((a, b) => a - b);
  return rates.length ? rates[Math.floor(rates.length / 2)]! : null;
}
function calibration(model: string) {
  return readStored<LegacySpeed>("oly-speed-v2", { m: {} }).m[model]?.c ?? 1;
}

export class StreamSpeedSampler {
  private previous: { id: string; tokens: number; at: number } | null = null;
  private tokens = 0;
  private ms = 0;
  observe(id: string, tokens: number, at: number) {
    if (this.previous?.id !== id) {
      this.tokens = 0;
      this.ms = 0;
      this.previous = { id, tokens, at };
      return null;
    }
    const delta = at - this.previous.at,
      growth = tokens - this.previous.tokens;
    if (growth > 0) {
      if (delta > 0 && delta <= 3000) {
        this.tokens += growth;
        this.ms += delta;
      }
      this.previous = { id, tokens, at };
    }
    return this.ms >= 300
      ? { tokens: this.tokens, ms: this.ms, rate: (this.tokens / this.ms) * 1000 }
      : null;
  }
}
const sampler = new StreamSpeedSampler();
let snapshot: { id: string; rate: number } | null = null;
const listeners = new Set<() => void>();
export function recordStreamSpeed(
  id: string,
  model: string,
  tokens: number,
  at: number,
  done: boolean,
) {
  const sample = sampler.observe(id, tokens * calibration(model), at);
  if (sample) {
    snapshot = { id, rate: sample.rate };
    for (const notify of listeners) notify();
  }
  if (done && sample) {
    const data = readStored<Record<string, { model: string; tokens: number; ms: number }>>(
      "chronos-speed-estimates-v1",
      {},
    );
    data[id] = { model, tokens: sample.tokens, ms: sample.ms };
    saveStored("chronos-speed-estimates-v1", Object.fromEntries(Object.entries(data).slice(-300)));
  }
}
export function useStreamSpeed(id: string | undefined) {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => snapshot,
    () => null,
  );
  return value && value.id === id ? value.rate : null;
}

export class ProviderSpeedSampler {
  private turns = new Map<
    string,
    { start: number; first: number; last: number; tokens: number; live: boolean }
  >();
  observe(turn: Pick<OrchestrationV2ProviderTurn, "id" | "status" | "tokenUsage">) {
    const usage = turn.tokenUsage;
    if (usage?.outputTokens === undefined) return null;
    const at = Date.parse(usage.updatedAt);
    if (!Number.isFinite(at)) return null;
    let previous = this.turns.get(turn.id);
    if (!previous || usage.outputTokens < previous.tokens) {
      previous = {
        start: at,
        first: usage.outputTokens,
        last: at,
        tokens: usage.outputTokens,
        live: turn.status === "running",
      };
      this.turns.set(turn.id, previous);
    }
    if (at < previous.last) return null;
    previous.last = at;
    previous.tokens = usage.outputTokens;
    if (turn.status === "running") return null;
    this.turns.delete(turn.id);
    const tokens = previous.tokens - previous.first,
      ms = previous.last - previous.start;
    return previous.live && tokens >= 30 && ms >= 300
      ? { tokens, ms, key: `chronos:${turn.id}:${previous.start}` }
      : null;
  }
}
const providerSampler = new ProviderSpeedSampler();
export function recordProviderSpeed(turns: readonly OrchestrationV2ProviderTurn[], model: string) {
  for (const turn of turns) {
    const sample = providerSampler.observe(turn);
    if (!sample) continue;
    const data = readStored<LegacySpeed & { v: number; seen: Record<string, number> }>(
      "oly-speed-v2",
      { v: 2, m: {}, seen: {} },
    );
    if (data.seen[sample.key]) continue;
    const id = turn.model ?? model;
    const row = data.m[id] ?? { d: "", r: [], g: [], t: [], f: [], c: 1 };
    data.m[id] = { ...row, r: [...row.r, [sample.tokens, sample.ms, Date.now()]].slice(-60) };
    data.seen[sample.key] = 1;
    data.seen = Object.fromEntries(Object.entries(data.seen).slice(-3000));
    saveStored("oly-speed-v2", data);
  }
}
