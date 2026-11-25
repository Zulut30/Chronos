import { artifactStore } from "./tools.mjs";

export async function galleryRequest(action, body) {
  const db = await artifactStore();
  switch (action) {
    case "list": return db.list().map(({source, ...card}) => card);
    case "open": return showArtifact(body.id);
    case "history": return db.history(body.id);
    case "restore": return db.restore(body.id, body.version, body.expectedVersion);
    case "pin":
      if (typeof body.pinned !== "boolean") throw Error("Выберите состояние закрепления");
      return db.pin(body.id, body.pinned);
    case "delete": return db.remove(body.id, body.expectedVersion);
    default: throw Error("Неизвестное действие");
  }
}

export async function showArtifact(id, confirmDelete = false) {
  const svc = process.env.OLY_STUDIO_URL || "http://127.0.0.1:4520";
  const url = new URL(confirmDelete ? "/artifacts.html" : "/artifact-view.html", svc);
  url.searchParams.set(confirmDelete ? "delete" : "id", id);
  const res = await fetch(new URL("/api/open",svc), {method:"POST", redirect:"error",
    headers:{"content-type":"application/json","x-oly":"1"}, body:JSON.stringify({artifact:id,confirmDelete,url:url.href})});
  if (!res.ok) throw Error("Студия не смогла открыть панель");
  const {delivered} = await res.json();
  if (!delivered) throw Error("Откройте окно Chronos и повторите");
  return {id, delivered, confirmationRequested:confirmDelete};
}
