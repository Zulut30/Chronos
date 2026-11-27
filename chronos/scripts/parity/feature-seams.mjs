// Extract the shipped JS as data. Never import a feature into Node or a user's renderer.
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(import.meta.dirname, "../../..");
const features = path.join(root, "apps/web/src/chronos/olympus/features");
const vite = createRequire(path.join(root, "apps/web/package.json")).resolve("vite");
const { parseAst } = await import(pathToFileURL(vite).href);
const selectors = new Set(["querySelector", "querySelectorAll", "closest", "matches", "getElementById", "getElementsByClassName", "getElementsByTagName"]);
const attributes = new Set(["getAttribute", "hasAttribute", "getAttributeNS"]);
const member = node => node?.computed ? node.property?.value : node?.property?.name;

function extract(code) {
  const sites = [];
  const rootScope = { bindings: new Map() };
  function walk(node, scope) {
    if (!node?.type) return;
    if (/Function/.test(node.type) || node.type === "BlockStatement") scope = { bindings: new Map(), parent: scope };
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier") scope.bindings.set(node.id.name, node.init);
    sites.push({ node, scope });
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) for (const item of child) walk(item, scope);
      else if (child?.type) walk(child, scope);
    }
  }
  walk(parseAst(code), rootScope);
  function binding(name, scope) {
    while (scope && !scope.bindings.has(name)) scope = scope.parent;
    return scope && [scope.bindings.get(name), scope];
  }
  function string(node, scope, depth = 0) {
    if (!node || depth > 12) return undefined;
    if (typeof node.value === "string") return node.value;
    if (node.type === "TemplateLiteral" && !node.expressions.length) return node.quasis[0].value.cooked;
    if (node.type === "Identifier") {
      const pair = binding(node.name, scope);
      return pair && string(...pair, depth + 1);
    }
    if (node.type === "BinaryExpression" && node.operator === "+") {
      const left = string(node.left, scope, depth + 1), right = string(node.right, scope, depth + 1);
      if (left !== undefined && right !== undefined) return left + right;
    }
  }
  const reads = new Map();
  function add(kind, value) {
    const entries = reads.get(kind) ?? new Set();
    entries.add(value);
    reads.set(kind, entries);
  }
  for (const { node, scope } of sites) {
    if (node.type === "MemberExpression" && member(node)) {
      const name = node.object?.name;
      const receiver = binding(name, scope)?.[0]?.name ?? name;
      if (["window", "globalThis"].includes(receiver)) {
        add(member(node).startsWith("__") ? "globals" : "window", member(node));
      }
    }
    if (node.type === "VariableDeclarator" && /(?:_SEL|SELECTOR)$/.test(node.id.name)) {
      const value = string(node.init, scope);
      if (value !== undefined) add("selectors", value);
    }
    if (node.type === "Literal" && typeof node.value === "string" && /^(?:https?:\/\/127\.0\.0\.1:45|\/?api\/)/.test(node.value)) add("endpoints", node.value);
    if (node.type === "MemberExpression" && member(node.object) === "dataset" && member(node)) {
      add("attributes", "data-" + member(node).replace(/[A-Z]/g, l => "-" + l.toLowerCase()));
    }
    if (node.type !== "CallExpression") continue;
    let method = member(node.callee);
    let index = method === "getAttributeNS" ? 1 : 0;
    if (node.callee.type === "Identifier") {
      const fn = binding(node.callee.name, scope)?.[0];
      const call = fn?.body;
      if (call?.type === "CallExpression" && selectors.has(member(call.callee))) {
        method = member(call.callee);
        index = fn.params.findIndex(p => p.name === call.arguments[0]?.name);
      }
    }
    const kind = selectors.has(method) ? "selectors" : attributes.has(method) ? "attributes" :
      member(node.callee.object) === "classList" && method === "contains" ? "classes" : undefined;
    const arg = node.arguments[index];
    if (!kind || !arg) continue;
    const value = string(arg, scope);
    if (value === undefined) add("expressions", method + "(" + code.slice(arg.start, arg.end) + ")");
    else add(kind, method === "getElementById" ? "#" + value : method === "getElementsByClassName" ? "." + value : value);
  }
  return Object.fromEntries([...reads.entries()].sort(([a],[b]) => a < b ? -1 : 1).map(([kind, values]) => [kind, [...values].sort()]));
}

const inventory = {};
for (const name of fs.readdirSync(features).filter(name => name.endsWith(".js")).sort()) {
  const bytes = fs.readFileSync(path.join(features, name));
  inventory[name] = { sha256: createHash("sha256").update(bytes).digest("hex"), ...extract(bytes.toString("utf8")) };
}
const output = path.join(root, "chronos/parity/feature-seams.json");
if (process.argv.includes("--write")) fs.writeFileSync(output, JSON.stringify(inventory, null, 2) + "\n");
else {
  const prior = JSON.parse(fs.readFileSync(output, "utf8"));
  for (const name of new Set([...Object.keys(prior), ...Object.keys(inventory)])) {
    for (const field of new Set([...Object.keys(prior[name] ?? {}), ...Object.keys(inventory[name] ?? {})])) {
      const before = [prior[name]?.[field] ?? []].flat(), after = [inventory[name]?.[field] ?? []].flat();
      for (const v of before.filter(x => !after.includes(x))) { console.error(name, field, "removed:", v); process.exitCode = 1; }
      for (const v of after.filter(x => !before.includes(x))) { console.error(name, field, "added:", v); process.exitCode = 1; }
    }
  }
}
