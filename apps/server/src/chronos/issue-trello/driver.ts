import { parseTrelloIssueUrl, TRELLO_HOST, TRELLO_LINK_SCOPE } from "@t3tools/contracts";
import type {
  IssueScopeTarget,
  IssueTarget,
  StandaloneIssueTrackerApi,
} from "@t3tools/source-control-core/server/IssueTracker";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  Action,
  Board,
  Card,
  Id,
  Label,
  List,
  Member,
  Organization,
  CARD_QUERY,
  MEMBER_FIELDS,
  actor,
  archive,
  httpAttachments,
  label,
  listStates,
  summary,
} from "./model.ts";
import { failure, kind, makeRest } from "./rest.ts";

const capabilities = {
  create: true,
  edit: true,
  comment: true,
  labels: true,
  assignees: true,
  due: true,
  reactions: false,
  templates: false,
  linkedPullRequests: false,
  events: false,
  search: true,
};
const permissions = { setState: true, comment: true, edit: true, labels: true, assignees: true };
const boardId = (scope: string) =>
  Schema.is(Id)(scope)
    ? Effect.succeed(scope)
    : Effect.fail(failure("board", "Неверный идентификатор доски Trello."));
const cardKey = (key: string) =>
  /^[a-zA-Z0-9]{8}$/.test(key)
    ? Effect.succeed(key)
    : Effect.fail(failure("card", "Укажите shortLink из ссылки на карточку Trello.", "not-found"));
const commentsPageSize = 50;
const boardPageSize = 250;

export const make = Effect.gen(function* () {
  const rest = yield* makeRest;
  const lists = (id: string) =>
    rest("lists", `boards/${id}/lists`, Schema.Array(List), {
      query: { filter: "all", fields: "name,closed" },
    }).pipe(Effect.map(listStates));
  const members = (id: string) =>
    rest("members", `boards/${id}/members`, Schema.Array(Member), {
      query: { fields: MEMBER_FIELDS },
    });
  const labels = (id: string) =>
    rest("labels", `boards/${id}/labels`, Schema.Array(Label), {
      query: { fields: "name,color", limit: "1000" },
    });

  const card = Effect.fn("Trello.card")(function* (target: IssueTarget, discover = false) {
    const key = yield* cardKey(target.key);
    const result = yield* rest("card", `cards/${key}`, Card, {
      query: { ...CARD_QUERY, attachments: "true", attachment_fields: "name,url" },
    });
    if (
      result.shortLink !== key ||
      (result.idBoard !== target.scope && !(discover && target.scope === TRELLO_LINK_SCOPE))
    )
      return yield* failure("card", "Карточка находится на другой доске Trello.", "not-found");
    return result;
  });
  const writeTarget = Effect.fn("Trello.writeTarget")(function* (target: IssueTarget) {
    const key = yield* cardKey(target.key);
    const identity = yield* rest("card", `cards/${key}`, Schema.Struct({ id: Id, idBoard: Id }), {
      query: { fields: "idBoard" },
    });
    if (identity.idBoard !== target.scope)
      return yield* failure("card", "Карточка находится на другой доске Trello.", "not-found");
    return identity.id;
  });

  const comments = Effect.fn("Trello.comments")(function* (key: string, before?: string) {
    if (before !== undefined && !Schema.is(Id)(before))
      return yield* failure("comments", "Неверный курсор комментариев Trello.");
    const rows = yield* rest("comments", `cards/${key}/actions`, Schema.Array(Action), {
      query: {
        filter: "commentCard,copyCommentCard",
        limit: String(commentsPageSize + 1),
        ...(before ? { before } : {}),
      },
    });
    const page = rows.slice(0, commentsPageSize);
    return {
      comments: page
        .map((a) => ({
          id: a.id,
          author: a.memberCreator ? actor(a.memberCreator) : null,
          body: a.data.text ?? "",
          createdAt: a.date,
          url: `https://trello.com/c/${key}#comment-${a.id}`,
        }))
        .reverse(),
      nextCursor: rows.length > page.length ? page.at(-1)!.id : null,
    };
  });

  const fieldIds = Effect.fn("Trello.fieldIds")(function* (
    id: string,
    patch: {
      readonly labels?: ReadonlyArray<string> | undefined;
      readonly assignees?: ReadonlyArray<string> | undefined;
    },
  ) {
    const ids = (
      names: ReadonlyArray<string>,
      options: ReadonlyArray<{ id: string; name: string }>,
    ) =>
      Effect.forEach(names, (value) => {
        const exact = options.find((o) => o.id === value);
        const matches = exact
          ? [exact]
          : options.filter((o) => o.name.toLowerCase() === value.trim().toLowerCase());
        return matches.length === 1
          ? Effect.succeed(matches[0]!.id)
          : Effect.fail(
              failure("update", `Доска Trello не содержит однозначного значения «${value}».`),
            );
      }).pipe(Effect.map((values) => [...new Set(values)]));
    const chosenLabels = patch.labels?.length
      ? (yield* labels(id)).map((l) => ({ id: l.id, name: label(l).name }))
      : [];
    const chosenMembers = patch.assignees?.length
      ? (yield* members(id)).map((m) => ({ id: m.id, name: m.username }))
      : [];
    return {
      ...(patch.labels === undefined ? {} : { idLabels: yield* ids(patch.labels, chosenLabels) }),
      ...(patch.assignees === undefined
        ? {}
        : { idMembers: yield* ids(patch.assignees, chosenMembers) }),
    };
  });

  // Nested board cards are paged by creation, even when the Issues page orders them by activity.
  // Apply the global ordering before cutting a UI page so late edits on older cards are visible.
  const listIssues: StandaloneIssueTrackerApi["listIssues"] = Effect.fn("Trello.listIssues")(
    function* (input) {
      const id = yield* boardId(input.scope);
      const states = yield* lists(id);
      const rows = [];
      const q = input.query?.trim().toLowerCase();
      const mention = input.involvement === "mentioned" ? "@" + input.viewer.toLowerCase() : null;
      const mentionsViewer = (text: string) =>
        mention !== null && (text.toLowerCase().match(/@[\w-]+/g) ?? []).includes(mention);
      const mentionedInComments = new Set<string>();
      if (mention) {
        let before: string | undefined;
        for (;;) {
          const actions: ReadonlyArray<Action> = yield* rest(
            "mentions",
            `boards/${id}/actions`,
            Schema.Array(Action),
            {
              query: {
                filter: "commentCard,copyCommentCard",
                limit: "1000",
                ...(before ? { before } : {}),
              },
            },
          );
          for (const a of actions)
            if (a.data.card && mentionsViewer(a.data.text ?? ""))
              mentionedInComments.add(a.data.card.id);
          if (actions.length < 1000) break;
          const last = actions.at(-1)!.id;
          if (before && last >= before)
            return yield* failure("mentions", "Trello повторил страницу действий.");
          before = last;
        }
      }
      let before: string | undefined;
      for (;;) {
        const page: ReadonlyArray<Card> = yield* rest(
          "list",
          `boards/${id}/cards`,
          Schema.Array(Card),
          {
            query: {
              ...CARD_QUERY,
              filter: input.state,
              sort: "-id",
              limit: String(boardPageSize),
              ...(before ? { before } : {}),
            },
          },
        );
        for (const c of page) {
          if (c.idBoard !== id) continue;
          const row = summary(c, states);
          if (input.state !== "all" && row.state.category !== input.state) continue;
          if (
            q &&
            ![c.name, c.desc, row.displayKey, c.shortLink].some((v) => v.toLowerCase().includes(q))
          )
            continue;
          const assigned = (login: string) =>
            row.assignees.some((m) => m.login.toLowerCase() === login.toLowerCase());
          if (input.assignee && !assigned(input.assignee)) continue;
          if (
            input.labels?.some(
              (name) => !row.labels.some((l) => l.name.toLowerCase() === name.toLowerCase()),
            )
          )
            continue;
          if (input.involvement === "assigned" && !assigned(input.viewer)) continue;
          if (input.involvement === "authored" && row.author?.login !== input.viewer) continue;
          if (mention && !mentionsViewer(c.desc) && !mentionedInComments.has(c.id)) continue;
          const order = (input.sort === "created" ? row.createdAt : row.updatedAt) + "/" + c.id;
          if (!input.cursor || order < input.cursor) rows.push({ order, row });
        }
        if (page.length < boardPageSize) break;
        const last = page.at(-1)!.id;
        if (before && last >= before)
          return yield* failure("list", "Trello повторил страницу карточек.");
        before = last;
      }
      rows.sort((a, b) => (a.order < b.order ? 1 : a.order > b.order ? -1 : 0));
      return {
        items: rows.slice(0, input.limit).map(({ row }) => row),
        nextCursor: rows.length > input.limit ? rows[input.limit - 1]!.order : null,
      };
    },
  );

  const api: StandaloneIssueTrackerApi = {
    kind,
    capabilities,
    parseIssueUrl: parseTrelloIssueUrl,
    standalone: {
      tracker: kind,
      displayName: "Trello",
      host: TRELLO_HOST,
      scopeNoun: "board",
      credential: { label: "API key:token", helpUrl: "https://trello.com/power-ups/admin" },
    },
    probeCredential: Effect.fn("Trello.probe")(function* (token) {
      const me = yield* rest("connect", "members/me", Member, {
        token,
        query: { fields: MEMBER_FIELDS },
      });
      const boards = yield* rest("boards", "members/me/boards", Schema.Array(Board), {
        token,
        query: { filter: "open", fields: "name,idOrganization" },
      });
      const orgs = yield* rest(
        "workspaces",
        "members/me/organizations",
        Schema.Array(Organization),
        {
          token,
          query: { fields: "displayName" },
        },
      );
      const names = new Map(orgs.map((org) => [org.id, org.displayName]));
      return {
        account: me.username,
        scopes: boards.map((b) => {
          const workspace = b.idOrganization && names.get(b.idOrganization);
          return { key: b.id, name: workspace ? workspace + " / " + b.name : b.name };
        }),
      };
    }),
    getViewer: () =>
      rest("viewer", "members/me", Member, { query: { fields: MEMBER_FIELDS } }).pipe(
        Effect.map((m) => m.username),
      ),
    listIssues,
    getIssue: Effect.fn("Trello.detail")(function* (input) {
      const c = yield* card(input, true);
      const states = yield* lists(c.idBoard);
      const page = yield* comments(c.shortLink);
      const viewer = yield* rest("viewer", "members/me", Member, {
        query: { fields: MEMBER_FIELDS },
      });
      return {
        ...summary(c, states),
        nativeScope: c.idBoard,
        body: c.desc,
        due: c.due,
        attachments: httpAttachments(c),
        states: [
          ...states.filter((l) => !l.closed || l.id === c.idList).map((l) => l.state),
          archive,
        ],
        viewer: viewer.username,
        viewerPermissions: permissions,
        events: [],
        linkedPullRequests: [],
        comments: page.comments,
        commentsCursor: page.nextCursor,
      };
    }),
    getIssueLink: Effect.fn("Trello.link")(function* (input) {
      const c = yield* card(input);
      return {
        title: c.name,
        displayKey: "#" + c.idShort,
        url: "https://trello.com/c/" + c.shortLink,
      };
    }),
    getComments: Effect.fn("Trello.olderComments")(function* (input) {
      yield* writeTarget(input);
      return yield* comments(input.key, input.cursor);
    }),
    create: Effect.fn("Trello.create")(function* (input) {
      const id = yield* boardId(input.scope);
      const first = (yield* lists(id)).find((l) => !l.closed);
      if (!first) return yield* failure("create", "На доске Trello нет открытых списков.");
      const fields = yield* fieldIds(id, input);
      const c = yield* rest(
        "create",
        "cards",
        Schema.Struct({ shortLink: Schema.String, idShort: Schema.Number }),
        {
          method: "POST",
          body: {
            idList: first.id,
            name: input.title,
            desc: input.body,
            ...fields,
            ...(input.due ? { due: input.due } : {}),
          },
        },
      );
      return {
        key: c.shortLink,
        displayKey: "#" + c.idShort,
        url: "https://trello.com/c/" + c.shortLink,
      };
    }),
    update: Effect.fn("Trello.update")(function* (input) {
      const id = yield* writeTarget(input);
      const fields = yield* fieldIds(input.scope, input);
      yield* rest("update", `cards/${id}`, Schema.Unknown, {
        method: "PUT",
        body: {
          ...fields,
          ...(input.title === undefined ? {} : { name: input.title }),
          ...(input.body === undefined ? {} : { desc: input.body }),
          ...(input.due === undefined ? {} : { due: input.due }),
        },
      });
    }),
    comment: Effect.fn("Trello.comment")(function* (input) {
      const id = yield* writeTarget(input);
      yield* rest("comment", `cards/${id}/actions/comments`, Schema.Unknown, {
        method: "POST",
        body: { text: input.body },
      });
    }),
    setState: Effect.fn("Trello.setState")(function* (input) {
      const id = yield* writeTarget(input);
      const destination =
        input.state === archive.name
          ? null
          : (yield* lists(input.scope)).find((l) => !l.closed && l.state.name === input.state);
      if (destination === undefined)
        return yield* failure("setState", "Этот список Trello недоступен.");
      yield* rest("setState", `cards/${id}`, Schema.Unknown, {
        method: "PUT",
        body: destination === null ? { closed: true } : { closed: false, idList: destination.id },
      });
    }),
    listCandidates: Effect.fn("Trello.candidates")(function* (input: IssueScopeTarget) {
      const id = yield* boardId(input.scope);
      const choices = yield* labels(id);
      return {
        labels: choices.map((l) => ({ ...label(l), description: null })),
        assignees: (yield* members(id)).map((m) => ({ ...actor(m), id: m.id })),
        truncated: choices.length >= 1000,
      };
    }),
  };
  return api;
});
