import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Tracer from "effect/Tracer";

export function makeLocalTraceRetention() {
  let successes = 0;
  return (span: Pick<Tracer.Span, "status" | "events">) => {
    if (span.status._tag === "Ended" && span.status.exit._tag === "Failure") return true;
    for (const [, , attributes] of span.events) {
      const level = attributes["effect.logLevel"];
      if (level === "Warning" || level === "Error" || level === "Fatal") return true;
    }
    return successes++ % 16 === 0;
  };
}

// An explicitly configured Effect threshold requests the original file detail at that level.
export const localTraceRetention = Config.option(Config.String("T3CODE_TRACE_MIN_LEVEL")).pipe(
  Effect.map((level) => Option.isSome(level) ? () => true : makeLocalTraceRetention()),
  Effect.orDie,
);
