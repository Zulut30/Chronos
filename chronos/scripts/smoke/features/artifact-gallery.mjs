import * as NodeAssert from "node:assert/strict";
import { waitFor } from "./artifact-wait.mjs";

export async function withSmokeFrame(client, prefix, read) {
  const match = url => url.startsWith(prefix);
  const target = await waitFor("packaged frame " + prefix, async () => {
    const { frameTree } = await client.send("Page.getFrameTree");
    const frame = frameTree.childFrames?.find(node => match(node.frame.url));
    if (frame) {
      const { executionContextId } = await client.send("Page.createIsolatedWorld",{frameId:frame.frame.id,worldName:"chronos-smoke"});
      return { contextId:executionContextId };
    }
    const { targetInfos } = await client.send("Target.getTargets");
    const guest = targetInfos.find(info => match(info.url));
    if (guest) return client.send("Target.attachToTarget",{targetId:guest.targetId,flatten:true});
  });
  const evaluate = async expression => {
    const reply = await client.send("Runtime.evaluate",{expression,contextId:target.contextId,returnByValue:true,awaitPromise:true},30000,target.sessionId);
    if (reply.exceptionDetails) throw Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
    return reply.result.value;
  };
  try {
    return await read(evaluate);
  } finally {
    if (target.sessionId) await client.send("Target.detachFromTarget",{sessionId:target.sessionId});
  }
}

export async function verifyStudioGallery(client, id) {
  await withSmokeFrame(client, "http://127.0.0.1:4520/artifacts.html", async evaluate => {
    const card = `document.querySelector('article[data-id="${id}"]')`;
    await waitFor("gallery card",()=>evaluate(card + " !== null"));
    NodeAssert.equal(await evaluate("document.documentElement.style.colorScheme"),"light");
    const search = value => evaluate(`document.querySelector("#search").value=${JSON.stringify(value)};document.querySelector("#search").dispatchEvent(new Event("input"));true`);
    await search("несуществующий артефакт");
    NodeAssert.equal(await evaluate('document.querySelector("#status").textContent'),"Ничего не найдено");
    await search("полировка");
    await evaluate(card+'.querySelector("[data-pin]").click()');
    await waitFor("pin and focus",()=>evaluate(card+'.querySelector("[data-pin]") === document.activeElement && document.activeElement.textContent === "Открепить"'));
    await evaluate(card+'.querySelector("summary").click()');
    await waitFor("two versions",()=>evaluate(card+'.querySelectorAll("li").length === 2'));
    await evaluate(card+'.querySelector("li button").click()');
    await waitFor("restored version",()=>evaluate(card+'.querySelectorAll("li").length === 3'));
    await evaluate(card+'.querySelector("nav button:last-child").focus();document.activeElement.click()');
    NodeAssert.equal(await evaluate('document.activeElement.value'),"cancel");
    await evaluate('document.querySelector("button[value=cancel]").click()');
    NodeAssert.equal(await evaluate(card+'.querySelector("nav button:last-child") === document.activeElement'),true);
    await evaluate(card+'.querySelector("nav button:last-child").click()');
    await evaluate('document.querySelector("button[value=delete]").click()');
    await waitFor("deletion",()=>evaluate(card+' === null && document.activeElement.id === "search"'));
    await evaluate('document.querySelector("#status button").click()');
    await waitFor("undo preserves the restored history",()=>evaluate(card+' !== null && '+card+'.querySelector("[data-pin]") === document.activeElement'));
    await search("");
  });
}
