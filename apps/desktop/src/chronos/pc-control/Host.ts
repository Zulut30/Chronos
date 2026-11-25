import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Hex from "effect/encoding/Hex";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import { globalShortcut } from "electron";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { isChronosVersion } from "@t3tools/shared/cliRelease";
import type { DesktopEnvironment } from "../../app/DesktopEnvironment.ts";
import { ElectronWindow } from "../../electron/ElectronWindow.ts";
import { DesktopIpc } from "../../ipc/DesktopIpc.ts";

import { setPcAgentEnvironment } from "./AgentEnvironment.ts";

class PcControlError extends Schema.TaggedError<PcControlError>()("PcControlError", {
  message: Schema.String,
}) {}

interface Controller {
  restore(): Promise<void>;
  stop(): void;
  ui(input: unknown): Promise<unknown>;
}

export const startPcControl = Effect.fn("Chronos.pcControl")(function* (
  env: DesktopEnvironment["Service"],
) {
  if (!env.isPackaged || !isChronosVersion(env.appVersion)) return;
  const NodePath = env.path;
  const random = yield* SecureRandom.SecureRandom;
  const tools = NodePath.join(env.resourcesPath, "chronos-pc");
  const key = Hex.encode(yield* random.randomBytes(32).pipe(Effect.orDie));
  const name = "chronos-pc-" + (yield* random.uuidV4().pipe(Effect.orDie));
  const socket =
    env.platform === "win32"
      ? "\\\\.\\pipe\\" + name
      : NodePath.join(Buffer.byteLength(NodeOS.tmpdir()) > 45 ? "/tmp" : NodeOS.tmpdir(), name);
  const ipc = yield* DesktopIpc;
  const windows = yield* ElectronWindow;
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());
  const factory = NodeModule.createRequire(NodePath.join(tools, "controller.cjs"))(
    "./controller.cjs",
  ) as {
    createController(options: Record<string, unknown>): Controller;
  };
  const controller = factory.createController({
    dir: NodePath.join(env.baseDir, "pc-control"),
    tools,
    socket,
    key,
    shortcut: globalShortcut,
    notify() {
      const main = runSync(windows.main);
      if (Option.isSome(main) && !main.value.isDestroyed())
        main.value.webContents.send("chronos:pc-changed");
    },
  });
  setPcAgentEnvironment({
    CHRONOS_PC_SOCKET: socket,
    CHRONOS_PC_CAPABILITY: key,
    CHRONOS_PC_NODE: yield* HostProcess.ExecutablePath,
    CHRONOS_PC_CLI: NodePath.join(tools, "bin", "client.cjs"),
    CHRONOS_PC_BIN: NodePath.join(tools, "bin"),
  });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      setPcAgentEnvironment({});
      controller.stop();
    }),
  );
  yield* ipc.handle({
    channel: "chronos:pc-settings",
    handler: (input) =>
      Effect.tryPromise({
        try: () => controller.ui(input),
        catch: (cause) =>
          new PcControlError({
            message: cause instanceof Error ? cause.message : "Ошибка управления ПК.",
          }),
      }),
  });
  yield* Effect.promise(() => controller.restore());
});
