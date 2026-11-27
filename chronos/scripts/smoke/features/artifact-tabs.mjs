import assert from "node:assert/strict";
import { waitFor } from "./artifact-wait.mjs";

export async function verifyTabsExample(client, evaluate, id) {
  const card = `article[data-id="${id}"] .art-cover`;
  await evaluate(`document.querySelector('${card}').click()`);
  const guestUrl = `chronos-artifact://${id}/index.html`;
  const guest = await waitFor("tabs example guest", async () => {
    const {targetInfos} = await client.send("Target.getTargets");
    return targetInfos.find(target => target.type === "webview" && target.url === guestUrl);
  });
  const {sessionId} = await client.send("Target.attachToTarget", {targetId:guest.targetId, flatten:true});
  const page = async expression => {
    const reply = await client.send("Runtime.evaluate", {expression,returnByValue:true},30000,sessionId);
    if (reply.exceptionDetails) throw Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
    return reply.result.value;
  };
  const wasDark = await evaluate('document.documentElement.classList.contains("dark")');
  try {
    await waitFor("pinned UI SDK registered its tabs", () => page('document.querySelectorAll("button[role=tab]").length === 2'));
    assert.equal(await page('document.querySelector("[role=tablist]").getAttribute("aria-label")'), "Разделы плана");
    await evaluate('document.querySelector("[data-artifact-view] webview").focus()');
    await page('document.querySelector("button[aria-selected=true]").focus()');
    for (const [key, keyCode, value, name] of [["ArrowRight",39,"meetings","Встречи"],["ArrowLeft",37,"tasks","Задачи"]]) {
      for (const type of ["rawKeyDown","keyUp"]) {
        await client.send("Input.dispatchKeyEvent", {type,key,code:key,windowsVirtualKeyCode:keyCode},30000,sessionId);
      }
      await waitFor("keyboard selected "+value, () => page(`(() => {
        const tab=document.activeElement, visible=[...document.querySelectorAll("[role=tabpanel]")].filter(el=>el.getClientRects().length);
        return tab.textContent===${JSON.stringify(name)} && tab.matches("button[data-selected][aria-selected=true]") &&
          visible.length===1 && visible[0].getAttribute("value")===${JSON.stringify(value)};
      })()`));
    }
    const backgrounds = [];
    for (const mode of ["light","dark"]) {
      await evaluate(`document.documentElement.classList.toggle("dark",${mode === "dark"})`);
      await waitFor("guest theme "+mode, () => page(`document.documentElement.dataset.theme==="${mode}"`));
      const colors = await page(`(() => {
        const selected=getComputedStyle(document.activeElement), other=getComputedStyle(document.querySelector("button:not([data-selected])"));
        const body=getComputedStyle(document.body);
        return {paper:body.backgroundColor,ink:body.color,fill:selected.backgroundColor,onFill:selected.color,
          edge:other.borderTopColor,ring:selected.outlineColor,ringWidth:parseFloat(selected.outlineWidth)};
      })()`);
      const luminance = color => {
        const channels = color.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255)
          .map(n=>n<=0.04045 ? n/12.92 : ((n+0.055)/1.055)**2.4);
        return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
      };
      for (const [a,b,min] of [["ink","paper",4.5],["onFill","fill",4.5],["edge","paper",3],["ring","paper",3],["fill","paper",3]]) {
        const l=luminance(colors[a]), r=luminance(colors[b]);
        assert.ok((Math.max(l,r)+0.05)/(Math.min(l,r)+0.05)>=min, mode+" contrast "+a+"/"+b);
      }
      assert.ok(colors.ringWidth >= 2, "Visible keyboard focus in "+mode);
      backgrounds.push(colors.paper);
    }
    assert.notEqual(backgrounds[0],backgrounds[1]);
    console.log("PASS: packaged UI SDK tabs, arrow keys, focus, selection and contrast in both themes");
  } finally {
    await evaluate(`document.documentElement.classList.toggle("dark",${wasDark})`);
    await client.send("Target.detachFromTarget",{sessionId});
  }
  await evaluate(`document.querySelector('[aria-label="К артефактам"]').click()`);
  await waitFor("back to gallery after tabs", () => evaluate(`Boolean(document.querySelector('${card}'))`));
}
