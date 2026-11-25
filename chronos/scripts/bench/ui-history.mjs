import assert from "node:assert/strict";

// Run after timing so approval UI and extended history creation cannot distort frame measurements.
export async function verifyHistoryAndApproval({ rpc, evaluate, navigate, wait, targets, launch }) {
  const id = crypto.randomUUID(),
    turns = 32;
  const get = (threadId) => rpc.call("orchestration.getThreadProjection", { threadId });
  await navigate(targets[1]);
  await launch(id, true);
  await wait("seed history", async () => (await get(id)).runs.at(-1)?.status === "completed");
  const verified = new Set();
  for (let i = 1; i <= turns; i++) {
    await rpc.call("orchestration.dispatchCommand", {
      type: "message.dispatch",
      createdBy: "user",
      creationSource: "web",
      commandId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
      threadId: id,
      attachments: [],
      dispatchMode: { type: "start_immediately" },
      text: "HISTORY_" + i + " bench-" + id,
    });
    await wait("history turn " + i, async () => {
      const p = await get(id);
      return (
        p.runs.at(-1)?.status === "completed" &&
        p.turnItems.some(
          (item) => item.type === "assistant_message" && item.text.trim() === "History response " + i + ".",
        )
      );
    });
    verified.add(i);
  }
  const history = await get(id);
  const assistant = history.turnItems.filter((item) => item.type === "assistant_message");
  assert.equal(verified.size, turns);
  const openMs = await evaluate(`(async () => {
    const path=window.__TSR_ROUTER__.state.location.pathname.split("/").slice(0,-1).join("/") + "/${id}";
    const t = performance.now();
    void window.__TSR_ROUTER__.navigate({to:path});
    for (;;) {
      await new Promise(requestAnimationFrame);
      if (uiBench.hasText("History response ${turns}.")) return performance.now()-t;
      if (performance.now()-t > 9000) throw Error("Long history did not open");
    }
  })()`);
  await wait(
    "earliest restored history page",
    () =>
      evaluate(`(() => {
    if (uiBench.hasText("MARK_" + "${id}" + "_0_")) return true;
    uiBench.topOfTimeline();
    const earlier = [...document.querySelectorAll("button[aria-label]")].find(b =>
      ["Load earlier turns","Загрузить более ранние ходы"].some(label => b.getAttribute("aria-label") === label || b.textContent.trim() === label) && !b.disabled);
    earlier?.click();
    return false;
  })()`),
    20000,
  );
  console.log("Cold history verified", verified.size + 1);
  const pendingBefore = await evaluate("__olyNotifications.waiting");
  const child = crypto.randomUUID();
  await launch(child, false, "APPROVAL_FIXTURE ");
  await wait("background approval", async () =>
    (await get(child)).runtimeRequests.find((r) => r.status === "pending"),
  );
  await wait("Olympus notification for approval", () =>
    evaluate("__olyNotifications.waiting > " + pendingBefore),
  );
  await navigate(child);
  await wait("approval action", () =>
    evaluate(`(() => {
      const accept = [...document.querySelectorAll("button")].find(b =>
        ["Одобрить","Approve","Allow"].includes(b.textContent.trim()) && !b.disabled && b.getClientRects().length);
      if (!accept) return false;
      accept.click();
      return true;
    })()`),
  );
  await wait("approval response", async () => (await get(child)).runs.at(-1)?.status === "completed");
  await wait("approved answer", () => evaluate("uiBench.hasText('Bench permission granted.')"));
  return {
    earliestPageRestored: true,
    completedTurns: turns + 1,
    snapshotAssistantMessages: assistant.length,
    openMs,
    approval: true,
    notification: true,
  };
}
