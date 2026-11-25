import * as S from "effect/Schema";
import type { IssueState } from "@t3tools/contracts";
import type { TrackerIssueSummary } from "@t3tools/source-control-core/server/IssueTracker";

export const Id = S.String.check(S.isPattern(/^[a-f\d]{24}$/i));
export const Member = S.Struct({
  id: S.String,
  username: S.String,
  fullName: S.optional(S.String),
  avatarUrl: S.optional(S.NullOr(S.String)),
});
export const Label = S.Struct({ id: S.String, name: S.String, color: S.NullOr(S.String) });
export const List = S.Struct({ id: S.String, name: S.String, closed: S.Boolean });
export const Board = S.Struct({ id: Id, name: S.String, idOrganization: S.NullOr(S.String) });
export const Organization = S.Struct({ id: S.String, displayName: S.String });
export const Action = S.Struct({
  id: Id,
  type: S.String,
  date: S.String,
  memberCreator: S.optional(S.NullOr(Member)),
  data: S.Struct({
    text: S.optional(S.String),
    card: S.optional(S.Struct({ id: Id })),
  }),
});
export const Card = S.Struct({
  id: Id,
  idBoard: Id,
  idList: S.String,
  idShort: S.Number,
  shortLink: S.String.check(S.isPattern(/^[a-zA-Z0-9]{8}$/)),
  name: S.String,
  desc: S.String,
  closed: S.Boolean,
  dateLastActivity: S.NullOr(S.String),
  due: S.NullOr(S.String),
  labels: S.Array(Label),
  members: S.optional(S.Array(Member)),
  badges: S.Struct({ comments: S.Number }),
  actions: S.optional(S.Array(Action)),
  attachments: S.optional(S.Array(S.Struct({ name: S.String, url: S.String }))),
});
export type Card = typeof Card.Type;
export type List = typeof List.Type;
export type Action = typeof Action.Type;
export const CARD_FIELDS =
  "idBoard,idList,idShort,shortLink,name,desc,closed,dateLastActivity,due,labels,badges";
export const MEMBER_FIELDS = "username,fullName,avatarUrl";
export const CARD_QUERY = {
  fields: CARD_FIELDS,
  members: "true",
  member_fields: MEMBER_FIELDS,
  actions: "createCard,copyCard,convertToCardFromCheckItem,emailCard",
};
export const archive: IssueState = { name: "Архив", category: "closed", closeReason: "archived" };

export const actor = (member: typeof Member.Type) => ({
  login: member.username,
  name: member.fullName ?? null,
  avatarUrl: member.avatarUrl ? member.avatarUrl + "/50.png" : null,
});
const colors: Record<string, string> = {
  green: "#4bce97",
  yellow: "#e2b203",
  orange: "#faa53d",
  red: "#f87168",
  purple: "#9f8fef",
  blue: "#579dff",
  sky: "#6cc3e0",
  lime: "#94c748",
  pink: "#e774bb",
  black: "#8590a2",
};
export const label = (item: typeof Label.Type) => ({
  name: item.name.trim() || item.color || item.id,
  color: colors[item.color?.split("_")[0] ?? ""] ?? null,
});
export function listStates(lists: ReadonlyArray<List>) {
  const used = new Set<string>([archive.name]);
  const counts = new Map<string, number>();
  for (const list of lists) counts.set(list.name, (counts.get(list.name) ?? 0) + 1);
  return lists.map((list) => {
    let name = list.name.trim() || list.id;
    if ((counts.get(list.name) ?? 0) > 1 || used.has(name)) name += ` [${list.id}]`;
    while (used.has(name)) name += ` [${list.id}]`;
    used.add(name);
    return { ...list, state: { category: "open" as const, name } };
  });
}
export function summary(card: Card, states: ReturnType<typeof listStates>): TrackerIssueSummary {
  const creator = card.actions?.find((a) =>
    ["createCard", "copyCard", "convertToCardFromCheckItem", "emailCard"].includes(a.type),
  )?.memberCreator;
  const createdAt = new Date(parseInt(card.id.slice(0, 8), 16) * 1000).toISOString();
  return {
    key: card.shortLink,
    displayKey: "#" + card.idShort,
    title: card.name,
    url: "https://trello.com/c/" + card.shortLink,
    author: creator ? actor(creator) : null,
    state: card.closed
      ? archive
      : (states.find((s) => s.id === card.idList)?.state ?? {
          category: "open",
          name: card.idList,
        }),
    createdAt,
    updatedAt: card.dateLastActivity ?? createdAt,
    closedAt: null,
    assignees: (card.members ?? []).map(actor),
    labels: card.labels.map(label),
    commentCount: card.badges.comments,
  };
}
export const httpAttachments = (card: Card) =>
  (card.attachments ?? []).filter(({ url }) => {
    try {
      const parsed = new URL(url);
      return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  });
