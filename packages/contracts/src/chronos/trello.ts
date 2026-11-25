import * as Schema from "effect/Schema";

// A short link carries no board ID. Only the tracker can resolve this placeholder.
export const TRELLO_LINK_SCOPE = "@card";
export const TRELLO_HOST = "trello.com";

export function parseTrelloIssueUrl(url: URL) {
  if (url.origin !== "https://trello.com" || url.username || url.password) return null;
  const key = /^\/c\/([a-zA-Z0-9]{8})(?:\/[^/]+)?\/?$/.exec(url.pathname)?.[1];
  return key ? { host: TRELLO_HOST, scope: TRELLO_LINK_SCOPE, key, workspace: "" } : null;
}

export const issueDueField = {
  due: Schema.optional(
    Schema.NullOr(
      Schema.String.check(
        Schema.makeFilter(
          (value) => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
        ),
      ),
    ),
  ),
};

export const issueCardDetailFields = {
  ...issueDueField,
  attachments: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.String, url: Schema.String })),
  ),
};
