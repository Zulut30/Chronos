import { isElectron } from "../../env";
import { studioClientId } from "./studioClient";

import { LOCAL_SERVICES } from "./serviceDefinitions";
export { LOCAL_SERVICES } from "./serviceDefinitions";
export type LocalService = keyof typeof LOCAL_SERVICES;

export function localServicesAvailable(): boolean {
  return (
    isElectron ||
    (typeof location !== "undefined" &&
      ["localhost", "127.0.0.1"].includes(location.hostname) &&
      (import.meta.env.DEV ||
        (location.protocol === "http:" && (location.port || "80") === "3773")))
  );
}

export function serviceUrl(service: LocalService, path = "/"): string {
  const base =
    import.meta.env.DEV && !isElectron
      ? `/chronos-local/${service}`
      : `http://127.0.0.1:${LOCAL_SERVICES[service].port}`;
  return `${base}${path}`;
}

export async function serviceRequest<T>(
  service: LocalService,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  if (!localServicesAvailable())
    throw new Error(
      "Эти расширения доступны в Chronos на компьютере с установленными локальными сервисами.",
    );
  const response = await fetch(serviceUrl(service, path), {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers: options.body === undefined ? {} : { "content-type": "application/json", "x-oly": "1" },
    body: options.body === undefined ? null : JSON.stringify(options.body),
    signal: options.signal ?? AbortSignal.timeout(35000),
  });
  const result: unknown = await response.json();
  if (!response.ok || (typeof result === "object" && result !== null && "error" in result)) {
    throw new Error(
      typeof result === "object" && result !== null && "error" in result
        ? String(result.error)
        : `${LOCAL_SERVICES[service].label}: HTTP ${response.status}`,
    );
  }
  return result as T;
}

export function serviceFrameUrl(
  service: LocalService,
  path: string,
  appearance: "light" | "dark",
): string {
  const params = new URLSearchParams({ theme: appearance, olympus: "1" });
  if (service === "mcp") params.set("embedded", "settings");
  if (typeof document !== "undefined") {
    const css = getComputedStyle(document.documentElement);
    for (const [name, variable] of Object.entries({
      bg: "--background",
      fg: "--foreground",
      muted: "--muted-foreground",
      border: "--border",
      panel: "--card",
      accent: "--primary",
      "primary-fg": "--primary-foreground",
      hover: "--accent",
      radius: "--control-radius",
    })) {
      const value = css.getPropertyValue(variable).trim();
      if (value) params.set(name, value);
    }
    params.set(
      "olympus",
      document.documentElement.dataset.themeId?.startsWith("olympus") ? "1" : "0",
    );
  }
  const url = new URL(`http://127.0.0.1:${LOCAL_SERVICES[service].port}${path}`);
  if (service === "studio") url.searchParams.set("to", studioClientId());
  url.hash = params.toString();
  return url.href;
}
