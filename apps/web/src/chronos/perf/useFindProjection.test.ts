import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { useFindProjection } from "./useFindProjection";

const mocks = vi.hoisted(() => ({ open: false, projection: vi.fn() }));
vi.mock("~/components/chat/threadFindStore", () => ({ useThreadFindOpen: () => mocks.open }));
vi.mock("~/state/entities", () => ({ useThreadProjection: mocks.projection }));

it("detaches the full projection when find closes and attaches it on reopen", () => {
  const ref = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") };
  function Find() {
    useFindProjection(ref, true);
    return null;
  }
  for (const open of [false, true, false, true]) {
    mocks.open = open;
    renderToStaticMarkup(createElement(Find));
    expect(mocks.projection).toHaveBeenLastCalledWith(open ? ref : null);
  }
});
