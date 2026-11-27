import * as NodeTimersPromises from "node:timers/promises";

export async function waitFor(label,test) {
  const end=Date.now()+45000;
  let last;
  do {
    try {const result=await test();if (result) return result;} catch(e) {last=e;}
    await NodeTimersPromises.setTimeout(200);
  } while(Date.now()<end);
  throw Error(label+" timed out"+(last ? ": "+last.message : ""));
}
