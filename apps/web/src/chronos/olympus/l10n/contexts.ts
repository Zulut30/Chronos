// The build hook supplies Rolldown's ESTree parser. Offsets are UTF-16 in both parsers.
type Node = { type: string; start: number; end: number; [field: string]: unknown };
export type Parse = (code: string) => unknown;
export type Site = {
  start: number; end: number; quote: string; parts: string[]; slots: string[];
  property: string; catalogArgument: boolean; context: (includeNeighbors?: boolean) => string[];
};

function isNode(value: unknown): value is Node {
  return !!value && typeof value === "object" && "type" in value && typeof value.type === "string";
}

function name(node: unknown): string {
  return isNode(node) ? String(node.name ?? node.value ?? "") : "";
}

type Frame = { node: Node; field: string; index: number };
function role({ node, field, index }: Frame): string {
  if (node.type === "Property") return field === "value" && !node.computed ? "." + name(node.key) : "computed/key";
  if (node.type === "ObjectExpression" && Array.isArray(node.properties)) {
    return "{" + node.properties.map((p: unknown) => isNode(p) ? name(p.key) : "").join(",") + "}";
  }
  if ((node.type === "CallExpression" || node.type === "NewExpression") && isNode(node.callee)) {
    const fn = node.callee;
    const method = fn.type === "MemberExpression" && !fn.computed ? "." + name(fn.property) : "";
    return node.type + method + "/" + field + index;
  }
  return node.type + "/" + field;
}

// Only stable JS members, object fields, constants and syntax participate in a tie break.
// Local bindings and UI copy have the same marker before and after minification/translation.
function semanticLandmarks(root: Node) {
  const values: { start: number; value: string }[] = [];
  function collect(node: Node, parent?: Node) {
    let value: string | undefined;
    if (node.type === "TemplateLiteral" || node.type === "Literal") {
      const first = Array.isArray(node.quasis) ? node.quasis[0] : undefined;
      const raw = isNode(first) && Array.isArray(node.quasis) && node.quasis.length === 1 ?
        (first.value as { cooked: unknown }).cooked : node.value;
      value = typeof raw === "number" ? String(raw) : typeof raw === "string" && /^[a-z][a-z\d]*(?:[.:/_-][a-z\d]+)+$/u.test(raw) ? raw : "literal";
    } else if (node.type === "Identifier" && (parent?.type === "Property" && parent.key === node ||
        parent?.type === "MemberExpression" && !parent.computed && parent.property === node)) value = "." + name(node);
    if (value !== undefined) values.push({ start: node.start, value });
    if (node.type === "TemplateLiteral") return;
    for (const child of Object.values(node)) {
      if (isNode(child)) collect(child, node);
      else if (Array.isArray(child)) for (const item of child) if (isNode(item)) collect(item, node);
    }
  }
  collect(root);
  return values.sort((a, b) => a.start - b.start);
}

function isData({ node, field }: Frame, catalogBindings: Set<string>): boolean {
  switch (node.type) {
    case "Property": return field === "key";
    case "MemberExpression": return field === "property";
    case "VariableDeclarator": return catalogBindings.has(name(node.id));
    case "BinaryExpression": return node.operator !== "+";
    case "SwitchCase": return field === "test";
    default: return node.type === "TaggedTemplateExpression" || node.type.startsWith("Import") || node.type.startsWith("Export");
  }
}

export function visitStrings(code: string, parse: Parse, visit: (site: Site) => boolean | void) {
  const program = parse(code);
  if (!isNode(program)) throw new Error("Expected an ESTree program");
  const catalogBindings = new Set<string>();
  if (Array.isArray(program.body)) {
    for (const statement of program.body) {
      if (!isNode(statement) || statement.type !== "ExportNamedDeclaration" || !Array.isArray(statement.specifiers)) continue;
      for (const spec of statement.specifiers) {
        if (isNode(spec) && /^[a-f\d]{16}$/u.test(name(spec.exported))) catalogBindings.add(name(spec.local));
      }
    }
  }
  const parents: Frame[] = [];
  let landmarks: { start: number; value: string }[] | undefined;
  function neighbors(start: number) {
    landmarks ??= semanticLandmarks(program as Node);
    let lo = 0, hi = landmarks.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (landmarks[mid]!.start < start) lo = mid + 1;
      else hi = mid;
    }
    const context = [];
    for (let distance = 1; distance <= 64; distance++) {
      context.push(landmarks[lo - distance]?.value ?? "", landmarks[lo + distance]?.value ?? "");
    }
    return context;
  }
  function walk(node: Node) {
    const parent = parents.at(-1);
    if (node.type === "TemplateLiteral" || (node.type === "Literal" && typeof node.value === "string")) {
      // Catalogue messages and syntax (property names, module specifiers, tagged templates)
      // are data even if a dictionary happens to contain the same words.
      if (parent && !isData(parent, catalogBindings)) {
        const owner = parents.findLast(({ node: p, field }) => p.type === "Property" && field === "value" &&
          !p.computed && isNode(p.value) && p.value.start === node.start);
        const property = name(owner?.node.key);
        if (!/^[a-f\d]{16}$/u.test(property) && !["id", "value", "command"].includes(property)) {
          const parts: string[] = [], slots: string[] = [];
          if (Array.isArray(node.quasis)) {
            let last: Node | undefined;
            for (const quasi of node.quasis) {
              if (!isNode(quasi)) throw new Error("Invalid ESTree template element");
              if (last) slots.push(code.slice(last.end + 2, quasi.start - 1));
              parts.push((quasi.value as { cooked: string }).cooked);
              last = quasi;
            }
          } else parts.push(String(node.value));
          // GT hashes English at call time. Minification renames gt/msg and the JSX T
          // component, but keeps the call argument and component-children shapes.
          const jsx = parents.at(-3);
          const catalogArgument =
            (parent?.node.type === "CallExpression" && parent.field === "arguments" && parent.index === 0) ||
            (property === "children" && jsx?.node.type === "CallExpression" &&
              Array.isArray(jsx.node.arguments) && isNode(jsx.node.arguments[0]) &&
              !["Literal", "TemplateLiteral"].includes(jsx.node.arguments[0].type));
          const opaque = visit({
            start: node.start, end: node.end, quote: code.charAt(node.start), parts, slots, property, catalogArgument,
            context: (includeNeighbors = true) => {
              const chain = parents.slice(-6).reverse().map(role);
              while (chain.length < 6) chain.push("");
              return includeNeighbors ? [...chain, ...neighbors(node.start)] : chain;
            },
          });
          if (opaque) return;
        }
      }
    }
    for (const [field, child] of Object.entries(node)) {
      if (isNode(child)) {
        parents.push({ node, field, index: -1 });
        walk(child);
        parents.pop();
      } else if (Array.isArray(child)) {
        for (const [index, item] of child.entries()) {
          if (!isNode(item)) continue;
          parents.push({ node, field, index });
          walk(item);
          parents.pop();
        }
      }
    }
  }
  walk(program);
}
