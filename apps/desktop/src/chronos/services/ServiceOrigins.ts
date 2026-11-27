import { services } from "./Sidecars.ts";

const servicePorts = new Set(services.map((service) => String(service.port)));
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

// Concurrent rehearsal profiles can use disjoint port ranges while keeping the original module URLs.
export const rehearsalOffset = process.env.CHRONOS_SWITCH_REHEARSAL === "1"
  ? Number(process.env.CHRONOS_SWITCH_PORT_OFFSET ?? 20_000) : 20_000;
if (!Number.isInteger(rehearsalOffset) || rehearsalOffset < 10_000 || rehearsalOffset > 60_000) {
  throw new Error("Invalid Chronos rehearsal port offset");
}

/**
 * The Olympus services answer CORS only for `Origin: t3code://app`, so the desktop
 * header policy must not strip it from requests to their loopback ports.
 */
export function isOlympusServiceUrl(url: URL): boolean {
  return (
    loopbackHosts.has(url.hostname.toLowerCase()) &&
    (servicePorts.has(url.port) ||
      (process.env.CHRONOS_SWITCH_REHEARSAL === "1" &&
        servicePorts.has(String(Number(url.port) - rehearsalOffset))))
  );
}
