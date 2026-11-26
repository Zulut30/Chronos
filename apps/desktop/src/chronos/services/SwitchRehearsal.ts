import * as Electron from "electron";
import { services } from "./Sidecars.ts";

export const rehearsalOffset = 20_000;

// Modules keep their original loopback URLs. Redirect them before the first renderer request.
export function isolateRehearsalRequests(backendPort: string | undefined) {
  if (!backendPort || !/^\d+$/u.test(backendPort))
    throw new Error("Missing rehearsal backend port");
  const ports = new Set(services.map((service) => service.port));
  Electron.session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (request, done) => {
      const url = new URL(request.url);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
        return done({ cancel: true });
      const port = Number(url.port);
      if (ports.has(port)) {
        url.port = String(port + rehearsalOffset);
        return done({ redirectURL: url.href });
      }
      done({ cancel: url.port !== backendPort && !ports.has(port - rehearsalOffset) });
    },
  );
}
