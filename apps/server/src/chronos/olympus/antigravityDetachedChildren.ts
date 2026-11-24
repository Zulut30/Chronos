// @effect-diagnostics nodeBuiltinImport:off -- Reads Antigravity 1.5 detached subagent metadata and inbox JSON files.
import * as NodeFSP from "node:fs/promises";

import * as Predicate from "effect/Predicate";

import { antigravityManagedPath } from "../../provider/acp/AntigravityProfilePaths.ts";

// chronos(olympus): server-syNn-CpO.mjs N05
const MAX_STEP_BYTES = 1024 * 1024;
const NATIVE_ID = /^[A-Za-z0-9-]{1,64}$/;
const OLY_MAX_MESSAGE_FILES = 256;
const OLY_MAX_DETACHED_CHILDREN = 64;

interface DetachedChildLaunch {
  readonly role: string;
  readonly prompt: string;
}

interface InboxToolCall {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string | undefined;
}

interface InboxMessage {
  readonly sender: string;
  readonly content: string | undefined;
  readonly conversationId: string | undefined;
  readonly toolCall: InboxToolCall | undefined;
}

interface DetachedSubagent {
  readonly conversationId: string | undefined;
  readonly state: string | undefined;
  readonly role: string | undefined;
}

interface DetachedInvokeRecord {
  readonly toolCallId: string;
  readonly launches: ReadonlyArray<DetachedChildLaunch>;
  readonly children: ReadonlyArray<{ readonly conversationId: string }>;
}

const olyString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** A conversation's inbox. Throws past a bound or on a file it cannot read, so nothing is proven. */
async function olyReadInbox(
  profileRoot: string,
  conversationId: string,
): Promise<ReadonlyArray<InboxMessage>> {
  const directory = [
    "antigravity-acp",
    "brain",
    conversationId,
    ".system_generated",
    "messages",
  ];
  const inbox = await antigravityManagedPath(profileRoot, directory, "directory");
  if (inbox === undefined) return [];
  const names = (await NodeFSP.readdir(inbox.path)).filter(
    (name) => name.endsWith(".json") && name !== "read.json",
  );
  if (names.length > OLY_MAX_MESSAGE_FILES) throw new Error("Too many messages");
  return Promise.all(
    names.map(async (name): Promise<InboxMessage> => {
      const file = await antigravityManagedPath(profileRoot, [...directory, name], "file");
      if (file === undefined || file.info.size > MAX_STEP_BYTES) throw new Error("Unreadable");
      const parsed: unknown = JSON.parse(await NodeFSP.readFile(file.path, "utf8"));
      if (!Predicate.isObject(parsed) || typeof parsed.sender !== "string") {
        throw new Error("Unreadable");
      }
      const tool =
        Predicate.isObject(parsed.sourceMetadata) && Predicate.isObject(parsed.sourceMetadata.tool)
          ? parsed.sourceMetadata.tool
          : undefined;
      const rawCall =
        tool !== undefined && Predicate.isObject(tool.toolCall) ? tool.toolCall : undefined;
      const toolCall =
        rawCall !== undefined &&
        typeof rawCall.id === "string" &&
        typeof rawCall.name === "string"
          ? {
              id: rawCall.id,
              name: rawCall.name,
              argumentsJson: olyString(rawCall.argumentsJson),
            }
          : undefined;
      return {
        sender: parsed.sender,
        content: olyString(parsed.content),
        conversationId: tool === undefined ? undefined : olyString(tool.conversationId),
        toolCall,
      };
    }),
  );
}

async function olyListDetachedChildIds(
  profileRoot: string,
  rootSessionId: string,
): Promise<ReadonlyArray<string> | undefined> {
  const children = await antigravityManagedPath(
    profileRoot,
    ["antigravity-acp", "brain", rootSessionId, ".system_generated", "subagents"],
    "directory",
  );
  if (children === undefined) return undefined;
  const entries = await NodeFSP.readdir(children.path).catch(() => undefined);
  if (entries === undefined) return undefined;
  const childIds = entries.flatMap((name) =>
    name.endsWith(".json") && NATIVE_ID.test(name.slice(0, -5)) ? [name.slice(0, -5)] : [],
  );
  return childIds.length > OLY_MAX_DETACHED_CHILDREN ? undefined : childIds;
}

function olyDetachedLaunchCall(
  message: InboxMessage,
  rootSessionId: string,
): InboxToolCall | undefined {
  return message.sender === rootSessionId &&
    (message.conversationId === undefined || message.conversationId === rootSessionId) &&
    message.toolCall?.name === "invoke_subagent"
    ? message.toolCall
    : undefined;
}

async function olyReadDetachedSubagent(
  profileRoot: string,
  rootSessionId: string,
  childId: string,
): Promise<DetachedSubagent | undefined> {
  const file = await antigravityManagedPath(
    profileRoot,
    [
      "antigravity-acp",
      "brain",
      rootSessionId,
      ".system_generated",
      "subagents",
      `${childId}.json`,
    ],
    "file",
  );
  if (file === undefined || file.info.size > MAX_STEP_BYTES) return undefined;
  const contents = await NodeFSP.readFile(file.path, "utf8").catch(() => undefined);
  if (contents === undefined) return undefined;
  let record: unknown;
  try {
    record = JSON.parse(contents);
  } catch {
    return undefined;
  }
  if (!Predicate.isObject(record)) return undefined;
  const conversationId = olyString(record.conversationId);
  if (conversationId !== undefined && conversationId !== childId) return undefined;
  return {
    conversationId,
    state: olyString(record.state),
    role: Predicate.isObject(record.subagentDescriptor)
      ? olyString(record.subagentDescriptor.role)
      : undefined,
  };
}

/**
 * agy 1.5 records detached children under `subagents/` instead of a SQLite `INVOKE_SUBAGENT` step;
 * the child's own inbox carries the parent's launching `invoke_subagent` tool call id.
 */
export async function olyFindDetachedInvokeRecord(
  profileRoot: string,
  rootSessionId: string,
  nativeTaskId: string,
  parseLaunches: (input: unknown) => ReadonlyArray<DetachedChildLaunch> | undefined,
): Promise<DetachedInvokeRecord | undefined> {
  if (typeof nativeTaskId !== "string") return undefined;
  const childIds = await olyListDetachedChildIds(profileRoot, rootSessionId);
  if (childIds === undefined || childIds.length === 0) return undefined;
  const matches: Array<DetachedInvokeRecord> = [];
  for (const childId of childIds) {
    const messages = await olyReadInbox(profileRoot, childId).catch(() => undefined);
    if (messages === undefined) return undefined;
    const launchMessage = messages.find(
      (message) => olyDetachedLaunchCall(message, rootSessionId)?.id === nativeTaskId,
    );
    if (launchMessage === undefined) continue;
    const subagent = await olyReadDetachedSubagent(profileRoot, rootSessionId, childId);
    if (subagent === undefined) return undefined;
    let parsedArgs: unknown;
    try {
      parsedArgs =
        launchMessage.toolCall?.argumentsJson === undefined
          ? undefined
          : JSON.parse(launchMessage.toolCall.argumentsJson);
    } catch {
      parsedArgs = undefined;
    }
    const [fromArgs] = parseLaunches(parsedArgs) ?? [];
    matches.push({
      toolCallId: nativeTaskId,
      launches: [
        fromArgs ?? {
          role: subagent.role ?? "",
          prompt: launchMessage.content ?? "",
        },
      ],
      children: [{ conversationId: childId }],
    });
  }
  const [match] = matches;
  return matches.length === 1 ? match : undefined;
}
