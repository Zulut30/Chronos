import { IssueTrackerHost } from "@t3tools/source-control-core/server/IssueTrackerHost";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";
import { make } from "./driver.ts";

const decodeBody = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

export const board = "650000000000000000000001";
export const person = { id: "member1", username: "jane", fullName: "Jane" };
export const list = { id: "list1", name: "In progress", closed: false };
export const bug = { id: "label1", name: "Bug", color: "red" };
export const card = {
  id: "650abcd00000000000000001",
  idBoard: board,
  idList: list.id,
  idShort: 17,
  shortLink: "A1b2C3d4",
  name: "Ship it",
  desc: "Notes for @jane",
  labels: [bug],
  members: [person],
  closed: false,
  dateLastActivity: "2026-11-05T12:00:00.000Z",
  due: "2026-12-05T12:00:00.000Z",
  actions: [
    {
      id: "650abcd00000000000000002",
      type: "createCard",
      date: "2023-09-20T00:00:00.000Z",
      data: {},
      memberCreator: person,
    },
  ],
  attachments: [
    { name: "Design", url: "https://example.org/design" },
    { name: "Bad", url: "javascript:alert(1)" },
  ],
  badges: { comments: 1 },
};
export const comment = {
  id: "660000000000000000000001",
  type: "commentCard",
  date: "2026-11-04T12:00:00.000Z",
  memberCreator: person,
  data: { text: "Looks good", card: { id: card.id } },
};
export const target = { cwd: "", host: "trello.com", scope: board, key: card.shortLink };

export interface MockRequest {
  method: string;
  url: URL;
  authorization: string | undefined;
  body: unknown;
}
export const fixture = (respond?: (r: MockRequest) => unknown) => {
  const requests: MockRequest[] = [];
  const routes: Record<string, unknown> = {
    "members/me": person,
    "members/me/boards": [{ id: board, name: "Roadmap", organization: { displayName: "Acme" } }],
    [`boards/${board}/lists`]: [list],
    [`boards/${board}/cards`]: [card],
    [`boards/${board}/members`]: [person],
    [`boards/${board}/labels`]: [bug],
    [`cards/${card.shortLink}`]: card,
    [`cards/${card.shortLink}/actions`]: [comment],
    [`cards/${card.id}`]: {},
    [`cards/${card.id}/actions/comments`]: comment,
    cards: card,
  };
  const tracker = make.pipe(
    Effect.provideService(IssueTrackerHost, {
      credentials: { get: () => Effect.succeedSome("key:token") },
    }),
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make((req) =>
        Effect.sync(() => {
          const request = {
            method: req.method,
            url: new URL(req.url),
            authorization: req.headers.authorization,
            body:
              req.body._tag === "Uint8Array"
                ? decodeBody(new TextDecoder().decode(req.body.body))
                : undefined,
          };
          requests.push(request);
          const answer = respond?.(request) ?? routes[request.url.pathname.slice(3)];
          const response =
            answer instanceof Response
              ? answer
              : answer === undefined
                ? new Response(null, { status: 404 })
                : Response.json(answer);
          return HttpClientResponse.fromWeb(req, response);
        }),
      ),
    ),
  );
  return { tracker, requests };
};
