// The desktop supplies its bundled Studio module only to its own backend.
import { pathToFileURL } from "node:url";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";
import * as Invocation from "../mcp/McpInvocationContext.ts";
import * as Access from "../mcp/McpToolAccess.ts";
import { loadCaller } from "../mcp/threadAccess.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";

export const artifactModule = process.env.CHRONOS_ARTIFACT_TOOLS;
const tool = Tool.make("artifact_studio", {
  description: "Create, update or reopen private Chronos HTML artifacts. Start with action guide for tool schemas. Publish from source file or files; update by id and expectedVersion. Use the same 2–4 words for title and <title>, one sentence description, one word icon. Define :root tokens, explicit body background, dark theme and responsive phone layout without horizontal scroll. External scripts only from cdnjs.cloudflare.com, cdn.jsdelivr.net or unpkg.com pinned to exact versions. Return the publication markdown card in chat.",
  parameters: Schema.Struct({
    action: Schema.String,
    input: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  success: Schema.Struct({result: Schema.Unknown, quickstart: Schema.String}),
  failure: OrchestratorMcpFailure, failureMode: "return",
  dependencies: [Invocation.McpInvocationContext, Threads.ThreadManagementService],
}).annotate(McpSchema.EnabledWhen, Invocation.hiddenFromOutsideClients);

export const artifactToolkit = Toolkit.make(tool);
type StudioModule = {
  quickstart: string;
  artifactTools: {name:string; description:string; inputSchema:unknown;
    run(input:Record<string,unknown>,context:Record<string,unknown>):Promise<unknown>}[];
};
export const artifactHandlers = Access.toLayer(artifactToolkit, {
  artifact_studio: Access.actsAsCaller(({action,input}) => Effect.gen(function* () {
    const scope = yield* Invocation.McpInvocationContext;
    const {thread} = yield* Invocation.requireThreadScope(scope,"artifact_studio");
    const {limits} = yield* loadCaller();
    return yield* Effect.tryPromise({
      try: async () => {
        const studio: StudioModule = await import(/* @vite-ignore */ pathToFileURL(artifactModule!).href);
        const name = "artifact_"+action;
        const selected = studio.artifactTools.find(entry => entry.name === name);
        if (!selected) throw Error("Неизвестное действие. Вызовите guide.");
        const result = action === "guide" ? studio.artifactTools.map(({name,inputSchema,description}) => ({action:name.slice(9),inputSchema,description}))
          : await selected.run(input ?? {}, {threadId:thread.threadId,environmentId:scope.environmentId,allowFile:limits.runtimeMode === "full-access"});
        return {result,quickstart:studio.quickstart};
      },
      catch: error => new OrchestratorMcpFailure({code:"invalid_request",message:error instanceof Error ? error.message : "Ошибка Студии"}),
    });
  })),
});
