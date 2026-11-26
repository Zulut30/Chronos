export const capabilities = ["theme","db","files.open","files.save"];
export function declared(input) {
  if (!Array.isArray(input) || input.some(cap => !capabilities.includes(cap))) throw Error("Неизвестная возможность страницы");
  return [...new Set(input)];
}
export const scheme = "chronos-artifact";
export const cdns = ["https://cdnjs.cloudflare.com","https://cdn.jsdelivr.net","https://unpkg.com"];
const sources = cdns.join(" ");
export const csp = ["default-src 'none'","base-uri 'none'","form-action 'none'","frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline' " + sources, "style-src 'self' 'unsafe-inline' " + sources,
  "connect-src 'self' " + sources,"img-src 'self' data: blob: " + sources,"font-src 'self' " + sources,
  "media-src 'self' blob: " + sources, "worker-src 'none'", "object-src 'none'"].join("; ");
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function own(url,id) {
  return url.protocol === scheme + ":" && url.hostname === id && !url.port && !url.username && !url.password;
}
export function allowed(url,id,mainFrame) {
  return own(url,id) || (!mainFrame && cdns.includes(url.origin) && !url.username && !url.password);
}
const mime = {html:"text/html; charset=utf-8",htm:"text/html; charset=utf-8",js:"text/javascript",mjs:"text/javascript",
  css:"text/css",json:"application/json",png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",webp:"image/webp",gif:"image/gif",
  svg:"image/svg+xml",ico:"image/x-icon",pdf:"application/pdf",woff:"font/woff",woff2:"font/woff2",ttf:"font/ttf",otf:"font/otf",avif:"image/avif"};
export function resource(store,id,raw,version) {
  const url = new URL(raw);
  if (!own(url,id)) return new Response(null,{status:403});
  let name;
  try {name=decodeURIComponent(url.pathname.slice(1)) || "index.html";} catch {return new Response(null,{status:400});}
  const file = store.file(id,name,version);
  if (!file) return new Response(null,{status:404});
  return new Response(file,{headers:{"Content-Type":mime[name.split(".").pop().toLowerCase()] || "application/octet-stream",
    "Content-Security-Policy":csp,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
}
