import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";

export async function verifySidebarFooter(client, { verify = true, capture } = {}) {
  const read = async expression => {
    const reply = await client.send("Runtime.evaluate", { expression, returnByValue: true });
    if (reply.exceptionDetails) throw Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
    return reply.result.value;
  };
  const measure = () => read("(" + function () {
    const side = document.querySelector("[data-app-sidebar]");
    const inner = side?.querySelector("[data-slot=sidebar-inner]");
    const footer = inner?.querySelector("[data-slot=sidebar-footer]");
    const rail = side?.querySelector("[data-slot=sidebar-rail]");
    if (!footer || !rail || !document.querySelector("[data-oly-studio]")) return null;
    const panel = side.getBoundingClientRect(), bounds = inner.getBoundingClientRect();
    const f = footer.getBoundingClientRect(), railRect = rail.getBoundingClientRect();
    const css = getComputedStyle(inner);
    // The meander is the vertically repeated background layer, anchored at the right edge.
    const layer = css.backgroundRepeat.split(",").findIndex(v => v.trim() === "repeat-y" || v.trim() === "no-repeat repeat");
    const stripeWidth = parseFloat(css.backgroundSize.split(",")[layer]);
    const right = bounds.right - parseFloat(css.borderRightWidth);
    const buttons = [...footer.querySelectorAll("button")].filter(b => b.checkVisibility() && b.getClientRects().length)
      .map(b => {
        const r = b.getBoundingClientRect();
        return { label: b.getAttribute("aria-label") || b.title || b.innerText, left:r.left, right:r.right, top:r.top, bottom:r.bottom };
      });
    return { dark:document.documentElement.classList.contains("dark"), theme:document.documentElement.dataset.themeId,
      width:panel.width, left:panel.left, right:panel.right, top:panel.top, bottom:panel.bottom,
      footerTop:f.top, footerBottom:f.bottom, stripLeft:right-stripeWidth, stripRight:right,
      stripeWidth, stripePosition:css.backgroundPositionX.split(",")[layer]?.trim(), buttons,
      rail:{ x:railRect.x+railRect.width/2, y:railRect.top+railRect.height/2 },
      clip:{ x:Math.max(0,panel.left), y:Math.max(0,f.top-4), width:Math.min(innerWidth-panel.left,Math.max(panel.width,...buttons.map(b=>b.right-panel.left))+6), height:Math.min(innerHeight,f.bottom)-f.top+4, scale:1 } };
  }.toString() + ")()");
  const navigate = await client.probe("performAction", { type:"navigate", to:"/" });
  assert.ok(navigate.ok, navigate.detail);
  let initial;
  for (let i=0; i<100 && !initial; i++) { initial=await measure(); if (!initial) await sleep(100); }
  if (!initial) throw Error("Sidebar footer is missing: " + JSON.stringify(await read(
    "({route:location.href,panels:Array.from(document.querySelectorAll('[data-slot*=sidebar]'),el=>el.dataset.slot).slice(0,45),studio:!!document.querySelector('[data-oly-studio]'),title:document.body.innerText.slice(0,270)})"
  )));
  const key = "chat_thread_sidebar_width";
  const originalWidth = await read("localStorage.getItem(" + JSON.stringify(key) + ")");
  // Replay real persisted widths in the disposable profile. The normal layout clamps
  // the narrow case against the measured brand width and reserves space for the chat.
  async function resize(stored) {
    const previous = await read("localStorage.getItem(" + JSON.stringify(key) + ")");
    if (previous === stored) return;
    await read(stored === null ? "localStorage.removeItem(" + JSON.stringify(key) + ")" :
      "localStorage.setItem(" + JSON.stringify(key) + "," + JSON.stringify(stored) + ")");
    const oldStart = await read("performance.timeOrigin");
    await client.send("Page.reload");
    for (let i = 0; i < 150; i++) {
      try {
        if (await read("performance.timeOrigin") !== oldStart && await measure()) {
          await sleep(300);
          return;
        }
      } catch (error) {
        if (!/context|navigation|document/i.test(String(error))) throw error;
      }
      await sleep(100);
    }
    throw Error("Sidebar did not mount after loading width " + stored);
  }
  async function scheme(dark) {
    if ((await measure()).dark === dark) return;
    const result = await client.probe("performAction", { type:"click",selector:"button[aria-label='День / ночь'],button[aria-label='Day / night']" });
    assert.ok(result.ok, result.detail);
    for(let i=0;i<25;i++){if((await measure()).dark===dark)return;await sleep(80);}
    throw Error("Sidebar appearance did not switch");
  }
  const results=[];
  try {
    for (const dark of [false,true]) {
      await scheme(dark);
      for (const [name,width] of [["default",256],["minimum",10],["wide",480]]) {
        await resize(name === "default" ? null : String(width));
        const m=await measure();
        const outside=m.buttons.filter(b=>b.left<m.left-1 || b.right>m.right+1 ||
          b.top<Math.max(m.top,m.footerTop)-1 || b.bottom>Math.min(m.bottom,m.footerBottom)+1);
        const overlap=m.buttons.filter(b=>b.left<m.stripRight-.5 && b.right>m.stripLeft+.5);
        const id=(dark?"night-":"day-")+name;
        results.push({id,...m,outside:outside.map(b=>b.label),overlap:overlap.map(b=>b.label)});
        if(capture)await capture(id,m.clip);
        if(verify){
          assert.equal(m.theme,"olympus",id);
          assert.ok(m.buttons.length>=8,id+" expected the full set of sidebar footer actions");
          assert.ok(m.stripeWidth>0 && m.stripeWidth<30 && /100%|right/u.test(m.stripePosition),id+" missing edge ornament");
          assert.ok(Math.abs(m.stripRight-m.right)<=2,id+" ornament is not at the sidebar edge");
          assert.deepEqual(outside,[],id+" buttons outside sidebar");
          assert.deepEqual(overlap,[],id+" buttons over ornament");
        }
      }
      const layouts = results.slice(-3);
      if (verify) assert.equal(new Set(layouts.map(m=>m.buttons.length)).size,1,"A footer action disappeared at a narrower width");
      const [defaultWidth,minimum,wide]=layouts.map(m=>m.width);
      assert.ok(minimum<defaultWidth && wide>defaultWidth,"Rail did not exercise three distinct widths: "+[minimum,defaultWidth,wide]);
    }
  } finally { await resize(originalWidth); await scheme(initial.dark); }
  return results;
}
