import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  attachMemoryTrimTarget,
  CHRONOS_MEMORY_TRIM_EVENT,
  registerMemoryTrimmer,
  runMemoryTrim,
} from "./memoryTrim";

class FakeDocument extends EventTarget {
  visibilityState = "visible";
}

describe("memoryTrim", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs all registered trimmers even when one throws and unregisters cleanly", () => {
    const calls: string[] = [];
    const off1 = registerMemoryTrimmer(() => {
      calls.push("a");
      throw new Error("boom");
    });
    const off2 = registerMemoryTrimmer(() => {
      calls.push("b");
    });
    try {
      runMemoryTrim();
      expect(calls).toEqual(["a", "b"]);
      off2();
      runMemoryTrim();
      expect(calls).toEqual(["a", "b", "a"]);
    } finally {
      off1();
      off2();
    }
  });

  it("handles direct desktop trim events and cancels pending hidden-tab trims on restore", () => {
    vi.useFakeTimers();
    const win = new EventTarget();
    const doc = new FakeDocument();
    let count = 0;
    const offTrim = registerMemoryTrimmer(() => {
      count += 1;
    });
    const detach = attachMemoryTrimTarget(win, doc, 1_000);
    try {
      win.dispatchEvent(new Event(CHRONOS_MEMORY_TRIM_EVENT));
      expect(count).toBe(1);

      doc.visibilityState = "hidden";
      doc.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(500);
      doc.visibilityState = "visible";
      doc.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(2_000);
      expect(count).toBe(1);

      doc.visibilityState = "hidden";
      doc.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(1_000);
      expect(count).toBe(2);

      doc.visibilityState = "visible";
      doc.dispatchEvent(new Event("visibilitychange"));
      doc.visibilityState = "hidden";
      doc.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(400);
      win.dispatchEvent(new Event(CHRONOS_MEMORY_TRIM_EVENT));
      expect(count).toBe(3);
      vi.advanceTimersByTime(2_000);
      expect(count).toBe(3);
    } finally {
      detach();
      offTrim();
    }
  });
});
