import { encodeSnapshot } from "./assets.mjs";
import { documentMethods } from "./documents.mjs";
import { capabilities } from "./policy.mjs";
let opened;
export async function artifactStore() {
  const { openArtifacts } = await import("./store.mjs");
  return opened ??= openArtifacts(process.env.CHRONOS_SERVICES_DATA || process.env.CHRONOS_HOME);
}

export const quickstart = "Публикуйте приватно из HTML-файла или карты files с index.html. Название и <title> — одинаковые 2–4 слова, описание — одно предложение, icon — одно слово. Задайте viewport, токены на :root, явный фон body, [data-theme=dark] и prefers-color-scheme. На ширине 360 px всё должно помещаться без горизонтальной прокрутки. Внешние скрипты только HTTPS с точной версией на cdnjs.cloudflare.com, cdn.jsdelivr.net или unpkg.com. Для обновления передайте id и expectedVersion. Вставьте возвращённый markdown в ответ, чтобы в чате появилась карточка.";
async function publish(input, context = {}) {
  let files = input.files;
  if (files === undefined) {
    if (context.allowFile === false) throw Error("Передайте содержимое index.html в files");
    const {open} = await import("node:fs/promises");
    const path = await import("node:path");
    if (!path.isAbsolute(input.source ?? "") || !/\.html?$/i.test(input.source)) throw Error("Укажите абсолютный путь к HTML-файлу");
    const handle = await open(input.source,"r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 15 * 1024 ** 2) throw Error("Ожидается HTML-файл до 15 МиБ");
      const buffer = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < buffer.length) {
        const {bytesRead} = await handle.read(buffer,offset,buffer.length-offset,offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      files = {"index.html":buffer.subarray(0,offset).toString("utf8")};
    } finally {await handle.close();}
  }
  const db = await artifactStore();
  const result = db.publish({...input,files},context);
  const link = "http://127.0.0.1:4520/artifact-view.html?id="+result.id;
  const label = input.title.replace(/[\[\]\\]/g," ");
  return {...result,link,markdown:"["+label+"]("+link+")",quickstart};
}

const string = { type: "string" };
function tool(name, description, properties, required, run) {
  return { name: "artifact_" + name, description, inputSchema: { type: "object", properties, required }, run };
}

export const artifactTools = [
  tool("guide", quickstart, {}, [], async () => ({quickstart})),
  tool("publish", quickstart,
    { id: string, source: string, title: string, description: string, icon: string, label: string,
      capabilities: {type:"array",items:{type:"string",enum:capabilities}},
      expectedVersion: { type: "integer" }, files: { type: "object", additionalProperties: {oneOf:[string,{type:"object",properties:{encoding:{const:"base64"},data:string},required:["encoding","data"],additionalProperties:false}]} } },
    ["title","description","icon","label"], publish),
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
