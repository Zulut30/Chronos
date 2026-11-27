// @effect-diagnostics nodeBuiltinImport:off -- This regression uses a private loopback HTTP fixture.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vite-plus/test";
import { isolateRehearsalRequests, rehearsalOffset } from "./SwitchRehearsal.ts";

const fixture = vi.hoisted(() => ({
  services: [{ port: 0 }],
  handle: vi.fn<(scheme: string, handler: (request: Request) => Promise<Response>) => void>(),
  onBeforeRequest: vi.fn(),
  fetch: vi.fn(() => Promise.reject(new Error("Chromium rejected the cross-port HTML response"))),
}));
vi.mock("./Sidecars.ts", () => ({ services: fixture.services }));
vi.mock("electron", () => ({
  session: { defaultSession: {
    protocol: { handle: fixture.handle }, webRequest: { onBeforeRequest: fixture.onBeforeRequest },
    fetch: fixture.fetch,
  } },
}));

it("serves the skills iframe as HTML from its private port and never follows redirects or writes", async () => {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.method + " " + req.url);
    expect(req.headers.origin).toBe("t3code://app");
    if (req.url === "/redirect") res.writeHead(302, { Location: "/unexpected" });
    else res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<main>Skills</main>");
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  try {
    const port = (server.address() as AddressInfo).port - rehearsalOffset;
    fixture.services[0]!.port = port;
    isolateRehearsalRequests("28531");
    const handler = fixture.handle.mock.calls[0]![1];
    const origin = `http://127.0.0.1:${port}`;
    const page = await handler(new Request(origin, { headers: { Accept: "text/html" } }));
    expect(page.headers.get("Content-Type")).toBe("text/html");
    expect(await page.text()).toBe("<main>Skills</main>");
    expect((await handler(new Request(origin + "/redirect"))).status).toBe(302);
    expect((await handler(new Request(origin, { method: "POST" }))).type).toBe("error");
    expect((await handler(new Request("https://example.invalid/"))).type).toBe("error");
    expect(requests).toEqual(["GET /", "GET /redirect"]);
    expect(fixture.fetch).not.toHaveBeenCalled();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
