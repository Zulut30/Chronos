import { encodeSnapshot } from "./assets.mjs";
import { documentMethods } from "./documents.mjs";
import { capabilities } from "./policy.mjs";
let opened;
export async function artifactStore() {
  const { openArtifacts } = await import("./store.mjs");
  return opened ??= openArtifacts(process.env.CHRONOS_SERVICES_DATA || process.env.CHRONOS_HOME);
}

const string = { type: "string" };
function tool(name, description, properties, required, run) {
  return { name: "artifact_" + name, description, inputSchema: { type: "object", properties, required }, run };
}

export const artifactTools = [
  tool("publish", "Опубликовать HTML-страницу и файлы. При конфликте версий прочитайте текущую и объедините правки.",
    { source: string, title: string, description: string, icon: string, label: string,
      capabilities: {type:"array",items:{type:"string",enum:capabilities}},
      expectedVersion: { type: "integer" }, files: { type: "object", additionalProperties: {oneOf:[string,{type:"object",properties:{encoding:{const:"base64"},data:string},required:["encoding","data"],additionalProperties:false}]} } },
    ["source","title","description","icon","label","files"], async input => (await artifactStore()).publish(input)),
  tool("restore", "Восстановить сохранённую версию новой публикацией.",
    { id: string, version: { type: "integer", minimum: 1 }, expectedVersion: { type: "integer", minimum: 1 } },
    ["id","version","expectedVersion"], async ({id,version,expectedVersion}) => (await artifactStore()).restore(id,version,expectedVersion)),
  ...["open","delete"].map(action => tool(action, action === "open" ? "Показать артефакт в Chronos." : "Запросить у пользователя подтверждение удаления в Chronos.",
    {id:string}, ["id"], async ({id}) => {
      if (!(await artifactStore()).history(id).length) throw Error("Артефакт не найден");
      const {showArtifact} = await import("./gallery.mjs");
      return showArtifact(id, action === "delete");
    })),
  tool("list", "Показать артефакты в текущем профиле.", {}, [], async () => (await artifactStore()).list()),
  ...documentMethods.map(method => {
    const fields = {id:string,collection:string,key:string,value:{type:"object"},where:{type:"object"},
      limit:{type:"integer"},after:string,operations:{type:"array",items:{type:"object"}}};
    const required = method === "batch" ? ["operations"] : ["collection",...(!["list","query"].includes(method) ? ["key"] : []),
      ...(["set","update"].includes(method) ? ["value"] : []),...(method === "query" ? ["where"] : [])];
    return tool("db_"+method,"Документная БД артефакта: "+method,fields,["id",...required],async ({id,...args}) => {
      const db = await artifactStore();
      if (!db.metadata(id).capabilities.includes("db")) throw Error("Артефакт не объявил db");
      return db.documents(id,method,args);
    });
  }),
  tool("history", "Показать сохранённые версии.", { id: string }, ["id"], async ({id}) => (await artifactStore()).history(id)),
  tool("pin", "Закрепить или открепить артефакт в галерее.", { id: string, pinned: {type:"boolean"} }, ["id","pinned"],
    async ({id,pinned}) => {
      if (typeof pinned !== "boolean") throw Error("Укажите логическое значение для закрепления");
      return (await artifactStore()).pin(id,pinned);
    }),
  tool("read", "Прочитать версию с исходным путём, текстом UTF-8 и двоичными файлами в base64.", {id:string,version:{type:"integer"}}, ["id"],
    async ({id,version}) => {
      const data = (await artifactStore()).read(id,version);
      return encodeSnapshot(data);
    }),
];
