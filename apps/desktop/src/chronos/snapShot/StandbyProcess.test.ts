import { afterEach, expect, it, vi } from "vite-plus/test";
import { makeStandbyProcess } from "./StandbyProcess.ts";

afterEach(() => { vi.useRealTimers(); });

it("expires only the spare and starts a fresh process after an idle period", () => {
  vi.useFakeTimers();
  const start = vi.fn(() => ({ alive: true, close: vi.fn() }));
  const pool = makeStandbyProcess(start, 60_000);
  expect(start).not.toHaveBeenCalled();
  pool.warm();
  const active = pool.take();
  pool.warm();
  const spare = start.mock.results[1]!.value;
  vi.advanceTimersByTime(59_999);
  expect(spare.close).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(spare.close).toHaveBeenCalledOnce();
  expect(active.close).not.toHaveBeenCalled();
  const cold = pool.take();
  expect(start).toHaveBeenCalledTimes(3);
  expect(cold).not.toBe(active);
  pool.cool();
  expect(cold.close).not.toHaveBeenCalled();
});
