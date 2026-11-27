import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { smokeRpc } from "./local-rpc.mjs";

// Recreate two recorded provider outcomes in the disposable visual-test profile.
// Creating an empty thread and reading its projection never starts a provider turn.
export async function seedQuotaNotices(evaluate) {
  const home = process.env.CHRONOS_HOME;
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  assert.equal(resolve(home), resolve(process.env.RUNNER_TEMP, "settings-profile"));
  const rpc = (tag, payload) => evaluate(`(${smokeRpc})(${JSON.stringify(tag)}, ${JSON.stringify(payload)})`);
  const { environment } = await rpc("server.getConfig", {});
  const { projectId } = await rpc("projects.ensureScratch", {});
  const db = new DatabaseSync(join(home, "userdata", "statev2.sqlite"), { open: true });
  const cases = [];
  try {
    db.exec("PRAGMA busy_timeout=5000");
    for (const knownReset of [false, true]) {
      const threadId = randomUUID();
      const modelSelection = {instanceId: "antigravity", model: "smoke"};
      const title = knownReset ? "Квота со временем сброса" : "Квота без времени сброса";
      await rpc("orchestration.dispatchCommand", {
        type: "thread.create", createdBy: "user", creationSource: "web", commandId: randomUUID(),
        projectId, threadId, title, runtimeMode: "approval-required", interactionMode: "default",
        modelSelection, branch: null, worktreePath: null,
      });
      const now = new Date().toISOString();
      const run = {
        id: randomUUID(), threadId, ordinal: 1, providerInstanceId: "antigravity", modelSelection,
        providerThreadId: null, userMessageId: randomUUID(), rootNodeId: null, activeAttemptId: null,
        status: "failed", requestedAt: now, startedAt: now, completedAt: now, checkpointId: null, contextHandoffId: null,
      };
      const item = {
        id: randomUUID(), threadId, runId: run.id, nodeId: null, providerThreadId: null,
        providerTurnId: null, nativeItemRef: null, parentItemId: null, ordinal: 1, status: "failed",
        title: null, startedAt: now, completedAt: now, updatedAt: now, type: "error",
        failure: { class: "usage_limit", code: "ANTIGRAVITY_INDIVIDUAL_QUOTA", message: "Квота подписки исчерпана",
          retryable: true, resetAt: knownReset ? new Date(Date.now() + 86400000).toISOString() : null },
      };
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(`INSERT INTO orchestration_v2_projection_runs
          (run_id,thread_id,ordinal,provider,provider_instance_id,status,requested_at,completed_at,payload_json)
          VALUES (?,?,1,'antigravity','antigravity','failed',?,?,?)`).run(run.id, threadId, now, now, JSON.stringify(run));
        db.prepare(`INSERT INTO orchestration_v2_projection_turn_items
          (turn_item_id,thread_id,run_id,ordinal,type,status,updated_at,payload_json)
          VALUES (?,?,?,1,'error','failed',?,?)`).run(item.id, threadId, run.id, now, JSON.stringify(item));
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      // Publish a normal shell update to subscribers after installing the recorded outcome.
      await rpc("orchestration.dispatchCommand", {
        type: "thread.metadata.update", commandId: randomUUID(), threadId, title: title + " · Antigravity",
      });
      cases.push({route: "/" + environment.environmentId + "/" + threadId, knownReset});
    }
  } finally {
    db.close();
  }
  return cases;
}
