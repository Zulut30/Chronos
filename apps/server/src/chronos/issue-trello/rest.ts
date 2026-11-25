import { IssueTrackerKind } from "@t3tools/contracts";
import { IssueTrackerError } from "@t3tools/source-control-core/server/IssueTracker";
import { IssueTrackerHost } from "@t3tools/source-control-core/server/IssueTrackerHost";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

export const kind = IssueTrackerKind.make("trello");

export const failure = (
  operation: string,
  detail: string,
  reason: IssueTrackerError["reason"] = "failed",
) => new IssueTrackerError({ tracker: kind, operation, reason, detail });

interface Options {
  readonly token?: string;
  readonly query?: Record<string, string>;
  readonly method?: "GET" | "POST" | "PUT";
  readonly body?: Record<string, unknown>;
}

export const makeRest = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const host = yield* IssueTrackerHost;
  return Effect.fn("Trello.request")(function* <A>(
    operation: string,
    path: string,
    schema: Schema.Decoder<A>,
    options: Options = {},
  ): Effect.fn.Return<A, IssueTrackerError> {
    const secret = options.token ?? Option.getOrUndefined(yield* host.credentials.get(kind));
    const pair = /^([A-Za-z0-9_-]+):([A-Za-z0-9_=-]+)$/.exec(secret ?? "");
    if (!pair)
      return yield* failure(operation, "Укажите API key и token Trello.", "unauthenticated");
    const url = new URL("https://api.trello.com/1/" + path);
    url.search = new URLSearchParams(options.query).toString();
    const request = HttpClientRequest.make(options.method ?? "GET")(url.href, {
      headers: {
        authorization: `OAuth oauth_consumer_key="${pair[1]}", oauth_token="${pair[2]}"`,
        accept: "application/json",
      },
    });
    const response = yield* http
      .execute(options.body ? HttpClientRequest.bodyJsonUnsafe(request, options.body) : request)
      .pipe(Effect.mapError(() => failure(operation, "Не удалось связаться с Trello.")));
    if (response.status === 429) {
      const now = yield* Clock.currentTimeMillis;
      const retry = response.headers["retry-after"];
      const seconds = retry && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : 0;
      const date = retry && !seconds ? Date.parse(retry) - now : 0;
      const intervals = ["api-key", "api-token"].map(
        (part) => Number(response.headers[`x-rate-limit-${part}-interval-ms`]) || 0,
      );
      return yield* new IssueTrackerError({
        tracker: kind,
        operation,
        reason: "rate-limited",
        detail: "Достигнут лимит запросов Trello.",
        retryAt: now + (Math.max(seconds, date || 0, ...intervals) || 10000),
      });
    }
    if (response.status === 401)
      return yield* failure(operation, "Trello отклонил ключ или токен.", "unauthenticated");
    if (response.status === 403)
      return yield* failure(operation, "Недостаточно прав Trello для этого действия.");
    if (response.status === 404)
      return yield* failure(operation, "Карточка или доска Trello недоступна.", "not-found");
    if (response.status < 200 || response.status >= 300)
      return yield* failure(operation, `Trello вернул HTTP ${response.status}.`);
    return yield* response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(schema)),
      Effect.mapError(() => failure(operation, "Не удалось прочитать ответ Trello.")),
    );
  });
});
