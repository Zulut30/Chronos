import * as NodeCrypto from "node:crypto";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { globalShortcut } from "electron";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { isChronosVersion } from "@t3tools/shared/cliRelease";
import type { DesktopEnvironment } from "../../app/DesktopEnvironment.ts";
import { ElectronWindow } from "../../electron/ElectronWindow.ts";
import { DesktopIpc } from "../../ipc/DesktopIpc.ts";

interface Controller {
  restore(): Promise<void>;
  stop(): void;
  ui(input: unknown): Promise<unknown>;
}

let agentEnvironment: Record<string, string> = {};
export const pcAgentEnvironment = () => agentEnvironment;

export const startPcControl = Effect.fn("Chronos.pcControl")(function* (env: DesktopEnvironment["Service"]) {
  if (!env.isPackaged || !isChronosVersion(env.appVersion)) return;
  const tools = NodePath.join(env.resourcesPath, "chronos-pc");
  const key = NodeCrypto.randomBytes(32).toString("hex");
  const name = "chronos-pc-" + NodeCrypto.randomUUID();
  const socket = env.platform === "win32" ? "\\\\.\\pipe\\" + name : NodePath.join(NodeOS.tmpdir(), name);
  const ipc = yield* DesktopIpc;
  const windows = yield* ElectronWindow;
  const factory = NodeModule.createRequire(NodePath.join(tools, "controller.cjs"))("./controller.cjs") as {
    createController(options: Record<string, unknown>): Controller;
  };
  const controller = factory.createController({
    dir: NodePath.join(env.baseDir, "pc-control"), tools, socket, key, shortcut: globalShortcut,
    notify() {
      const main = Effect.runSync(windows.main);
      if (Option.isSome(main) && !main.value.isDestroyed()) main.value.webContents.send("chronos:pc-changed");
    },
  });
  agentEnvironment = {
    CHRONOS_PC_SOCKET: socket, CHRONOS_PC_KEY: key,
    CHRONOS_PC_CLI: NodePath.join(tools, "bin", "client.cjs"),
    CHRONOS_PC_BIN: NodePath.join(tools, "bin"),
  };
  yield* Effect.addFinalizer(() => Effect.sync(() => { agentEnvironment = {}; controller.stop(); }));
  yield* ipc.handle({
    channel: "chronos:pc-settings",
    handler: input => Effect.tryPromise(() => controller.ui(input)),
  });
  yield* Effect.promise(() => controller.restore());
});
