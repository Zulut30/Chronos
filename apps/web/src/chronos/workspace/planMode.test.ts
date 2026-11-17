import { expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  DraftId,
  useComposerDraftStore,
  markPromotedDraftThreadByRef,
} from "../../composerDraftStore";
import { readChronosInteractionMode } from "./planMode";

it("retains independent Plan choices across draft switches, content clearing and promotion", () => {
  const env = EnvironmentId.make("chronos-plan-test");
  const a = DraftId.make("chronos-plan-a"),
    b = DraftId.make("chronos-plan-b");
  const threadId = ThreadId.make("chronos-plan-thread");
  const store = useComposerDraftStore.getState();
  store.setProjectDraftThreadId(scopeProjectRef(env, ProjectId.make("chronos-plan-project")), a, {
    threadId,
  });
  store.setPrompt(b, "independent draft");
  store.setInteractionMode(a, "plan");
  expect(readChronosInteractionMode(b)).toBe("default");
  expect(readChronosInteractionMode(a)).toBe("plan");
  store.clearComposerContent(a);
  expect(readChronosInteractionMode(a)).toBe("plan");
  markPromotedDraftThreadByRef(scopeThreadRef(env, threadId));
  expect(readChronosInteractionMode(a)).toBe("plan");
  store.setInteractionMode(scopeThreadRef(env, threadId), "default");
  expect(readChronosInteractionMode(a)).toBe("default");
  store.clearDraftThread(a);
  store.clearDraftThread(b);
});
