import * as Electron from "electron";
import { rehearsalOffset } from "./ServiceOrigins.ts";
import { services } from "./Sidecars.ts";

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
    if ((ports.has(port) || ports.has(port - rehearsalOffset)) && !["GET", "HEAD", "OPTIONS"].includes(request.method)) return Response.error();
    if (!ports.has(port)) {
      if (url.port !== backendPort && !ports.has(port - rehearsalOffset)) return Response.error();
      return session.fetch(request, { bypassCustomProtocolHandlers: true, redirect: "manual" });
    }
    url.port = String(port + rehearsalOffset);
    // Chromium's session fetch applies another origin check to the replacement port.
    // Serve the private response on the original URL so iframe documents retain their
    // real origin for relative modules and the parent's language/theme messages.
    const headers = new Headers({ Origin: "t3code://app" });
    for (const name of ["accept", "range", "if-none-match"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    // @effect-diagnostics-next-line globalFetch:off -- Electron requires a streaming Fetch response at its protocol boundary.
    const upstream = await fetch(url, { method: request.method, headers, signal: request.signal, redirect: "manual" });
    const responseHeaders = new Headers(upstream.headers);
    if (responseHeaders.has("content-encoding")) {
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
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
