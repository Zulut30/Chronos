const fileLimit = 15 * 1024 ** 2;
const pageLimit = 16 * 1024 ** 2;
export function decodeFiles(files) {
  if (!files || typeof files !== "object" || Array.isArray(files) || !Object.hasOwn(files,"index.html")) throw Error("Требуется index.html");
  const entries = Object.entries(files);
  if (entries.length > 255) throw Error("Не более 255 файлов на публикацию");
  const binaryFiles = [];
  let total = 0;
  const decoded = entries.map(([name,input]) => {
    if (name.split("/").some(part => !part || part === "." || part === "..") || /[\\:#?%\x00-\x1f]/u.test(name)) throw Error("Invalid file name");
    let content;
    if (typeof input === "string") {
      if (Buffer.byteLength(input) > fileLimit) throw Error("Файл больше 15 МБ");
      content = Buffer.from(input);
    } else {
      if (input instanceof Uint8Array) content = Buffer.from(input);
      else {
        if (input?.encoding !== "base64" || typeof input.data !== "string" || input.data.length > Math.ceil(fileLimit/3)*4)
          throw Error("Ожидается base64 до 15 МБ");
        content = Buffer.from(input.data,"base64");
        if (content.toString("base64") !== input.data) throw Error("Некорректный base64");
      }
      binaryFiles.push(name);
    }
    if (content.length > fileLimit) throw Error("Файл больше 15 МБ");
    total += content.length;
    if (total > pageLimit) throw Error("Страница больше 16 МБ");
    return [name,content];
  });
  return {decoded,binaryFiles};
}
export function encodeSnapshot({binaryFiles = [],files,...snapshot}) {
  const binary = new Set(binaryFiles);
  return {...snapshot,files:Object.fromEntries(Object.entries(files).map(([name,data]) => [name,
    binary.has(name) ? {encoding:"base64",data:data.toString("base64")} : data.toString("utf8")]))};
}
