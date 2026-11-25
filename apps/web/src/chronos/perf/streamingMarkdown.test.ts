import { Atom, AtomRegistry } from "effect/reactivity";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { streamingMarkdownAtom } from "./streamingMarkdown";

afterEach(() => { vi.useRealTimers(); });

it("paints short text immediately, coalesces long append bursts, and isolates message identities", () => {
  vi.useFakeTimers();
  const registry = AtomRegistry.make({ scheduleTask: (task) => task() });
  const a = Atom.make<string | null>("a");
  const b = Atom.make<string | null>("another draft");
  const visible = streamingMarkdownAtom(a);
  const unmount = registry.mount(visible);
  try {
    registry.set(a, "ab");
    expect(registry.get(visible)).toBe("ab");
    const code = "x".repeat(5000);
    registry.set(a, code);
    vi.advanceTimersByTime(80);
    registry.set(a, code + "b");
    expect(registry.get(visible)).toBe("ab");
    expect(registry.get(streamingMarkdownAtom(b))).toBe("another draft");
    vi.advanceTimersByTime(45);
    expect(registry.get(visible)).toBe(code + "b");
    registry.set(a, code + "bc");
    registry.set(a, null);
    vi.advanceTimersByTime(125);
    expect(registry.get(visible)).toBeNull();
  } finally {
    unmount();
    registry.dispose();
  }
});
