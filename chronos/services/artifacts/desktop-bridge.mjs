import {randomUUID} from "node:crypto";
import {parentPort} from "node:worker_threads";
import {uuid} from "./policy.mjs";

const pending = new Map();
parentPort?.on("message",message => {
  if (message?.kind === "artifact-delivered") pending.get(message.request)?.(message.delivered);
});
export function deliverToDesktop(id,confirmDelete) {
  if (!uuid.test(id)) throw Error("Некорректный идентификатор артефакта");
  if (!parentPort) return null;
  const request = randomUUID();
  return new Promise(resolve => {
    const finish = delivered => {pending.delete(request);clearTimeout(timer);resolve(delivered ? 1 : 0);};
    const timer = setTimeout(()=>finish(false),6000);
    pending.set(request,finish);
    parentPort.postMessage({kind:"artifact-open",id,confirmDelete:confirmDelete === true,request});
  });
}
