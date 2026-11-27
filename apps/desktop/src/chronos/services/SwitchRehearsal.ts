import * as Electron from "electron";
import { services } from "./Sidecars.ts";

export const rehearsalOffset = 20_000;

// Keep each module's original URL and origin. Chromium makes a cross-port redirect opaque to CORS.
export function isolateRehearsalRequests(backendPort: string | undefined) {
  if (!backendPort || !/^\d+$/u.test(backendPort))
    throw new Error("Missing rehearsal backend port");
  const ports = new Set(services.map((service) => service.port));
  const session = Electron.session.defaultSession;
  session.protocol.handle("http", async (request) => {
    const url = new URL(request.url);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return Response.error();
    const port = Number(url.port);
    if (!ports.has(port)) {
      if (url.port !== backendPort && !ports.has(port - rehearsalOffset)) return Response.error();
      return session.fetch(request, { bypassCustomProtocolHandlers: true, redirect: "manual" });
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) return Response.error();
    url.port = String(port + rehearsalOffset);
    // Chromium's session.fetch rejects a cross-port HTML document (ERR_FAILED) even when
    // the sidecar returned 200. Only the allowlisted, read-only private service uses Node.
    const headers = new Headers(request.headers);
    headers.set("Origin", "t3code://app");
    return fetch(url, { method: request.method, headers, redirect: "manual", signal: request.signal });
  });
  session.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (request, done) => {
      const url = new URL(request.url);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
        return done({ cancel: true });
      const port = Number(url.port);
      if (ports.has(port))
        return done({ cancel: !request.frame?.top?.url.startsWith("t3code://app/") });
      done({ cancel: url.port !== backendPort && !ports.has(port - rehearsalOffset) });
    },
  );
}
