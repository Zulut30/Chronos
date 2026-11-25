let opened;
async function store() {
  const { openArtifacts } = await import("./store.mjs");
  return opened ??= openArtifacts(process.env.CHRONOS_SERVICES_DATA || process.env.CHRONOS_HOME);
}

const string = { type: "string" };
function tool(name, description, properties, required, run) {
  return { name: "artifact_" + name, description, inputSchema: { type: "object", properties, required }, run };
}

export const artifactTools = [
  tool("publish", "Publish a local HTML file map. Re-read and merge on version conflict.",
    { source: string, title: string, description: string, icon: string, label: string,
      expectedVersion: { type: "integer" }, files: { type: "object", additionalProperties: string } },
    ["source","title","description","icon","label","files"], async input => (await store()).publish(input)),
  tool("restore", "Восстановить сохранённую версию новой публикацией.",
    { id: string, version: { type: "integer", minimum: 1 }, expectedVersion: { type: "integer", minimum: 1 } },
    ["id","version","expectedVersion"], async ({id,version,expectedVersion}) => (await store()).restore(id,version,expectedVersion)),
  tool("list", "List artifacts in this local profile.", {}, [], async () => (await store()).list()),
  tool("history", "List saved versions.", { id: string }, ["id"], async ({id}) => (await store()).history(id)),
  tool("pin", "Set sidebar pin preference.", { id: string, pinned: {type:"boolean"} }, ["id","pinned"],
    async ({id,pinned}) => {
      if (typeof pinned !== "boolean") throw Error("Expected boolean");
      return (await store()).pin(id,pinned);
    }),
  tool("read", "Read a version and its UTF-8 source files.", {id:string,version:{type:"integer"}}, ["id"],
    async ({id,version}) => {
      const data = (await store()).read(id,version);
      return {...data,files:Object.fromEntries(Object.entries(data.files).map(([name,bytes]) => [name,bytes.toString("utf8")]))};
    }),
];
