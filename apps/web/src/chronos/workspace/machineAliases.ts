import { useSyncExternalStore } from "react";
function subscribe(listener: () => void) {
  window.addEventListener("chronos:aliases", listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener("chronos:aliases", listener);
    window.removeEventListener("storage", listener);
  };
}
function snapshot() {
  try {
    return localStorage.getItem("oly-machines-aliases") ?? "{}";
  } catch {
    return "{}";
  }
}
export function useMachineAliases(): Record<string, string> {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "{}");
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "object" && value !== null
      ? Object.fromEntries(
          Object.entries(value).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  } catch {
    return {};
  }
}
