import { IssueOperationError, TRELLO_LINK_SCOPE, type ProjectId } from "@t3tools/contracts";
import type { IssueTrackerError } from "@t3tools/source-control-core/server/IssueTracker";
import * as Effect from "effect/Effect";
import type { SupportedProject } from "../../issue/IssueService.ts";

type BoundProject = Omit<SupportedProject, "project"> & {
  project: Pick<SupportedProject["project"], "id" | "title" | "workspaceRoot">;
};

// A card can move between boards without changing its URL. Only the current board grants writes.
export const resolveTrelloLink = Effect.fn("Trello.resolveLink")(function* (
  projects: ReadonlyArray<BoundProject>,
  key: string,
  preferred?: ProjectId,
) {
  const ordered = projects.toSorted(
    (a, b) => Number(b.project.id === preferred) - Number(a.project.id === preferred),
  );
  const seen = new Set<SupportedProject["accountId"]>();
  let fallback;
  let error: IssueTrackerError | undefined;
  for (const lender of ordered) {
    if (seen.has(lender.accountId)) continue;
    seen.add(lender.accountId);
    const read = yield* lender.api
      .getIssue({
        cwd: lender.project.workspaceRoot,
        host: lender.host,
        scope: TRELLO_LINK_SCOPE,
        key,
      })
      .pipe(Effect.result);
    if (read._tag === "Failure") {
      if (!error || error.reason === "not-found") error = read.failure;
      continue;
    }
    const { nativeScope, ...card } = read.success;
    if (!nativeScope || card.key !== key) continue;
    const own = ordered.find((p) => p.accountId === lender.accountId && p.scope === nativeScope);
    const project = own ?? lender;
    const ref = {
      projectId: project.project.id,
      tracker: project.tracker,
      host: project.host,
      scope: nativeScope,
      key,
      writable: !!own,
    };
    const answer = {
      ...ref,
      issue: {
        ...card,
        ...ref,
        projectTitle: project.project.title,
        capabilities: project.api.capabilities,
      },
    };
    if (own) return answer;
    fallback ??= answer;
  }
  if (fallback) return fallback;
  return yield* error ??
    new IssueOperationError({
      operation: "resolveUrl",
      reason: "not-found",
      detail: "Ни один подключённый аккаунт не видит эту карточку Trello.",
    });
});
