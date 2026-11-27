import type {
  ProviderUsageLimitsUpdate,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

const WINDOW_KIND_ORDER: Record<ServerProviderUsageWindow["kind"], number> = {
  session: 0,
  weekly: 1,
  monthly: 2,
  other: 3,
};

export function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function sortWindows(
  windows: Iterable<ServerProviderUsageWindow>,
): ReadonlyArray<ServerProviderUsageWindow> {
  return [...windows].toSorted(
    (left, right) =>
      WINDOW_KIND_ORDER[left.kind] - WINDOW_KIND_ORDER[right.kind] ||
      left.id.localeCompare(right.id),
  );
}

export function makeUsageLimits(input: {
  readonly checkedAt: string;
  readonly windows: Iterable<ServerProviderUsageWindow>;
}): ServerProviderUsageLimits {
  return { checkedAt: input.checkedAt, windows: sortWindows(input.windows) };
}

export function makeUnavailableUsageLimits(input: {
  readonly checkedAt: string;
  readonly reason: "unsupported" | "probeFailed";
  readonly message?: string;
}): ServerProviderUsageLimits {
  return {
    checkedAt: input.checkedAt,
    windows: [],
    unavailable: {
      reason: input.reason,
      ...(input.message ? { message: input.message } : {}),
    },
  };
}

export function applyUsageLimitsUpdate(input: {
  readonly previous: ServerProviderUsageLimits | undefined;
  readonly update: ProviderUsageLimitsUpdate;
  readonly checkedAt: string;
}): ServerProviderUsageLimits | undefined {
  const { previous, update } = input;
  if (update.windows.length === 0 || previous?.unavailable?.reason === "unsupported") {
    return previous;
  }
  const previousExpired =
    previous?.unavailable?.validUntil !== undefined &&
    Date.parse(previous.unavailable.validUntil) <= Date.parse(input.checkedAt);
  const merged = new Map(
    (previousExpired ? [] : previous?.windows)?.map((window) => [window.id, window] as const),
  );
  // Codex repeats unchanged limits on token ticks; avoid allocating snapshots for no-ops.
  let changed = false;
  for (const window of update.windows) {
    const existing = merged.get(window.id);
    const next: ServerProviderUsageWindow = {
      ...window,
      usedPercent: clampPercent(window.usedPercent),
      ...(window.resetsAt === undefined && existing?.resetsAt !== undefined
        ? { resetsAt: existing.resetsAt }
        : {}),
      ...(window.windowDurationMins === undefined && existing?.windowDurationMins !== undefined
        ? { windowDurationMins: existing.windowDurationMins }
        : {}),
    };
    if (existing === undefined || !usageWindowEquals(existing, next)) {
      merged.set(window.id, next);
      changed = true;
    }
  }
  if (!changed && previous !== undefined) {
    return previous;
  }
  const unavailable =
    previous === undefined || previousExpired
      ? { reason: "probeFailed" as const }
      : previous.unavailable;
  return {
    ...makeUsageLimits({ checkedAt: input.checkedAt, windows: merged.values() }),
    ...(previous?.resetCredits !== undefined ? { resetCredits: previous.resetCredits } : {}),
    ...(previous?.zeroSpendCap ? { zeroSpendCap: true } : {}),
    ...(unavailable !== undefined ? { unavailable } : {}),
  };
}

function usageWindowEquals(a: ServerProviderUsageWindow, b: ServerProviderUsageWindow): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.label === b.label &&
    a.usedPercent === b.usedPercent &&
    (a.modelIds === b.modelIds ||
      (a.modelIds !== undefined &&
        b.modelIds !== undefined &&
        a.modelIds.length === b.modelIds.length &&
        a.modelIds.every((id, index) => id === b.modelIds?.[index]))) &&
    (a.providerIds === b.providerIds ||
      (a.providerIds !== undefined &&
        b.providerIds !== undefined &&
        a.providerIds.length === b.providerIds.length &&
        a.providerIds.every((id, index) => id === b.providerIds?.[index]))) &&
    a.resetsAt === b.resetsAt &&
    a.windowDurationMins === b.windowDurationMins
  );
}

export function resolveUsageLimitsAfterProbe(input: {
  readonly published: ServerProviderUsageLimits | undefined;
  readonly probed: ServerProviderUsageLimits | undefined;
  readonly claudeCheckedAt?: string;
}): ServerProviderUsageLimits | undefined {
  const { published, probed } = input;
  if (input.claudeCheckedAt && probed?.unavailable?.reason === "probeFailed") {
    const now = Date.parse(input.claudeCheckedAt);
    // chronos: neither a failed retry nor a cache hit advances the age of an observation.
    const readings = [probed, published]
      .filter(
        (reading): reading is ServerProviderUsageLimits =>
          !!reading && reading.unavailable?.reason !== "unsupported" && reading.windows.length > 0,
      )
      .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt));
    for (const reading of readings) {
      const observed = Date.parse(reading.checkedAt);
      const expires = Math.min(
        observed + 3_600_000,
        reading.unavailable?.validUntil ? Date.parse(reading.unavailable.validUntil) : Infinity,
      );
      if (!(observed <= now && now < expires)) continue;
      const windows = reading.windows.filter(
        (w) => w.resetsAt === undefined || Date.parse(w.resetsAt) > now,
      );
      if (windows.length > 0)
        return {
          checkedAt: reading.checkedAt,
          windows,
          unavailable: {
            reason: "probeFailed",
            message:
              "Fresh Claude subscription limits are unavailable. Showing the last reported values.",
            validUntil: DateTime.formatIso(DateTime.makeUnsafe(expires)),
          },
        };
    }
    return makeUnavailableUsageLimits({
      checkedAt: input.claudeCheckedAt,
      reason: "probeFailed",
      message:
        "Claude Code could not retrieve subscription limits. Try /usage in this account later.",
    });
  }
  if (probed?.unavailable?.reason === "probeFailed" && published) {
    const now = Date.parse(probed.checkedAt);
    if (
      !published.unavailable &&
      published.windows.every((window) => !window.resetsAt || Date.parse(window.resetsAt) > now)
    ) {
      return published;
    }
    // chronos: an empty retry cannot supersede a still-active event from this account.
    if (published.unavailable?.reason !== "unsupported" && probed.windows.length === 0) {
      const windows = published.windows.filter(
        (window) => window.resetsAt !== undefined && Date.parse(window.resetsAt) > now,
      );
      if (windows.length > 0) return { ...probed, checkedAt: published.checkedAt, windows };
    }
  }
  if (
    published &&
    probed &&
    !published.unavailable &&
    !probed.unavailable &&
    Date.parse(published.checkedAt) > Date.parse(probed.checkedAt)
  ) {
    return { ...probed, checkedAt: published.checkedAt, windows: published.windows };
  }
  return probed;
}
