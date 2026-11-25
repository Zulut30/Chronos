import { describe, expect, it } from "@effect/vitest";
import { ProjectId, IssueTrackerAccountId } from "@t3tools/contracts";
import { resolveTrelloLink } from "./resolveLink.ts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { board, card, comment, fixture, list, target } from "./trelloFixture.ts";

describe("Trello REST tracker", () => {
  it.effect(
    "prefers the account bound to the current board and marks a borrowed card read-only",
    () =>
      Effect.gen(function* () {
        const first = fixture();
        const second = fixture();
        const api = yield* first.tracker;
        const borrowed = {
          tracker: api.kind,
          host: "trello.com",
          scope: "another",
          accountId: null,
          api,
          project: { id: ProjectId.make("first"), title: "First", workspaceRoot: "/one" },
        };
        const own = {
          ...borrowed,
          scope: board,
          api: yield* second.tracker,
          accountId: IssueTrackerAccountId.make("second"),
          project: { id: ProjectId.make("second"), title: "Second", workspaceRoot: "/two" },
        };
        const resolved = yield* resolveTrelloLink(
          [borrowed, own],
          card.shortLink,
          borrowed.project.id,
        );
        expect(resolved).toMatchObject({ projectId: own.project.id, scope: board, writable: true });
        expect(first.requests.length).toBeGreaterThan(0);
        expect(second.requests.length).toBeGreaterThan(0);
        expect(yield* resolveTrelloLink([borrowed], card.shortLink)).toMatchObject({
          projectId: borrowed.project.id,
          scope: board,
          writable: false,
        });
      }),
  );

  it.effect("probes both secrets before storing them and lists workspace-qualified boards", () =>
    Effect.gen(function* () {
      const fake = fixture();
      const api = yield* fake.tracker;
      expect(yield* api.probeCredential("another:secret")).toEqual({
        account: "jane",
        scopes: [{ key: board, name: "Acme / Roadmap" }],
      });
      expect(
        fake.requests.every(
          (r) =>
            r.authorization === 'OAuth oauth_consumer_key="another", oauth_token="secret"' &&
            !r.url.href.includes("secret"),
        ),
      ).toBe(true);
      expect(yield* api.probeCredential("no-pair").pipe(Effect.flip)).toMatchObject({
        reason: "unauthenticated",
      });
      expect(fake.requests).toHaveLength(2);
    }),
  );

  it.effect(
    "maps metadata without contaminating the editable description and pages comments by action id",
    () =>
      Effect.gen(function* () {
        const actions = Array.from({ length: 51 }, (_, i) => ({
          ...comment,
          id: (100 - i).toString(16).padStart(24, "0"),
        }));
        const fake = fixture(({ url }) =>
          url.pathname.endsWith("/actions")
            ? url.searchParams.has("before")
              ? actions.slice(50)
              : actions
            : undefined,
        );
        const api = yield* fake.tracker;
        const detail = yield* api.getIssue(target);
        expect(detail).toMatchObject({
          nativeScope: board,
          body: card.desc,
          due: card.due,
          title: card.name,
          key: card.shortLink,
          displayKey: "#17",
          url: "https://trello.com/c/" + card.shortLink,
          state: { category: "open", name: list.name },
          author: { login: "jane" },
          assignees: [{ name: "Jane" }],
          labels: [{ name: "Bug", color: "#f87168" }],
          attachments: [{ name: "Design", url: "https://example.org/design" }],
          commentsCursor: actions[49]!.id,
        });
        expect(detail.comments).toHaveLength(50);
        const older = yield* api.getComments({ ...target, cursor: detail.commentsCursor! });
        expect(older).toMatchObject({
          comments: [{ id: actions[50]!.id, body: comment.data.text }],
          nextCursor: null,
        });
        expect(fake.requests.at(-1)?.url.searchParams.get("before")).toBe(actions[49]!.id);
      }),
  );

  it.effect(
    "sorts across REST pages before slicing and carries filters into the next UI page",
    () =>
      Effect.gen(function* () {
        const cards = Array.from({ length: 251 }, (_, i) => ({
          ...card,
          id: (900 - i).toString(16).padStart(24, "0"),
          idShort: i + 1,
          shortLink: i.toString(16).padStart(8, "0"),
          dateLastActivity: i === 250 ? "2026-11-20T00:00:00.000Z" : card.dateLastActivity,
        }));
        const fake = fixture(({ url }) =>
          url.pathname.endsWith("/cards")
            ? url.searchParams.get("before") === cards[249]!.id
              ? cards.slice(250)
              : cards.slice(0, 250)
            : undefined,
        );
        const api = yield* fake.tracker;
        const input = {
          ...target,
          state: "open",
          involvement: "assigned",
          viewer: "jane",
          sort: "updated",
          limit: 1,
          labels: ["bug"],
          query: "notes",
        } as const;
        const first = yield* api.listIssues(input);
        expect(first.items[0]?.displayKey).toBe("#251");
        const second = yield* api.listIssues({ ...input, cursor: first.nextCursor! });
        expect(second.items[0]?.displayKey).toBe("#1");
        expect((yield* api.listIssues({ ...input, assignee: "other" })).items).toEqual([]);
      }),
  );

  it.effect("moves, archives, reopens and clears fields while refusing writes across boards", () =>
    Effect.gen(function* () {
      const fake = fixture();
      const api = yield* fake.tracker;
      yield* api.setState!({ ...target, state: "Архив" });
      yield* api.setState!({ ...target, state: list.name });
      yield* api.update!({ ...target, labels: [], assignees: [], due: null });
      const wrong = yield* api.comment!({ ...target, scope: "another", body: "no" }).pipe(
        Effect.flip,
      );
      expect(wrong.reason).toBe("not-found");
      expect(fake.requests.filter((r) => r.method !== "GET").map((r) => r.body)).toEqual([
        { closed: true },
        { closed: false, idList: list.id },
        { idLabels: [], idMembers: [], due: null },
      ]);
      expect(
        (yield* (yield* fixture(({ url }) =>
          url.pathname.endsWith(card.shortLink) ? { ...card, closed: true } : undefined,
        ).tracker).getIssue(target)).state.category,
      ).toBe("closed");
    }),
  );

  it.effect(
    "returns account, permission, rate limit and malformed response errors without credential disclosure",
    () =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const fake = fixture(
          () => new Response("private text", { status: 429, headers: { "retry-after": "12" } }),
        );
        const api = yield* fake.tracker;
        const limited = yield* api.probeCredential("demo:never-log").pipe(Effect.flip);
        expect(limited).toMatchObject({ reason: "rate-limited", retryAt: now + 12000 });
        expect(JSON.stringify(limited)).not.toContain("never-log");
        expect(fake.requests).toHaveLength(1);
        for (const [status, reason] of [
          [401, "unauthenticated"],
          [403, "failed"],
          [404, "not-found"],
          [200, "failed"],
        ] as const) {
          const other = yield* fixture(() => new Response("bad", { status })).tracker;
          expect((yield* other.getViewer(target).pipe(Effect.flip)).reason).toBe(reason);
        }
      }),
  );
});
