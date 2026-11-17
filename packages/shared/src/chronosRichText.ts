export const CHRONOS_RICH_COLORS: Readonly<Record<string, readonly [string, string]>> = {
  red: ["#C62828", "#FF8A80"],
  orange: ["#C25100", "#FFB74D"],
  yellow: ["#9A7300", "#FFE082"],
  green: ["#2E7D32", "#81C784"],
  teal: ["#00796B", "#4DB6AC"],
  cyan: ["#00838F", "#80DEEA"],
  blue: ["#1952C5", "#8AB4FF"],
  purple: ["#6A1B9A", "#CE93D8"],
  pink: ["#AD1457", "#F48FB1"],
  gray: ["#5B5F68", "#B0BEC5"],
  gold: ["#8A6A12", "#E3BF5C"],
  brown: ["#6D4C41", "#BCAAA4"],
};

function color(value: string, background: boolean, portable: boolean): string | null {
  const name = value.toLowerCase().replace(/^grey$/, "gray");
  const named = CHRONOS_RICH_COLORS[name];
  if (named) {
    if (!portable) return `var(--chronos-${background ? "bg" : "c"}-${name},${name})`;
    if (!background) return named[0];
    return (
      "#" +
      [1, 3, 5]
        .map((i) =>
          Math.round(parseInt(named[0].slice(i, i + 2), 16) * 0.16 + 255 * 0.84)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    );
  }
  return /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|(?:rgb|hsl)a?\([\d\s.,%/deg+-]{1,60}\)|transparent|inherit|currentcolor)$/i.test(
    value,
  )
    ? value
    : null;
}

export function chronosRichStyle(source: string, portable = false): string {
  const result: string[] = [];
  for (const declaration of source.split(";")) {
    const at = declaration.indexOf(":");
    if (at < 1) continue;
    let name = declaration.slice(0, at).trim().toLowerCase();
    const raw = declaration
      .slice(at + 1)
      .trim()
      .replace(/\s*!important$/i, "");
    const value = raw.replace(/var\(--chronos-(?:bg|c)-[a-z]+,([a-z]+)\)/g, "$1");
    let safe: string | null = null;
    if (name === "background") name = "background-color";
    if (name === "color" || name === "background-color")
      safe = color(value, name === "background-color", portable);
    if (name === "font-weight" && /^(?:bold|bolder|normal|[1-9]00)$/i.test(value)) safe = value;
    if (name === "font-style" && /^(?:italic|normal)$/i.test(value)) safe = value;
    if (
      (name === "text-decoration" || name === "text-decoration-line") &&
      /^(?:underline|line-through|overline|none)(?:\s+(?:underline|line-through|overline))*$/i.test(
        value,
      )
    )
      safe = value;
    if (safe) result.push(`${name}:${safe}`);
  }
  return result.join(";");
}

interface RichNode {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: RichNode[];
}

export function chronosPrepareRichText() {
  return (tree: RichNode) => {
    const visit = (node: RichNode) => {
      if (node.type === "element" && node.properties) {
        const props = node.properties;
        delete props.dataChronosStyle;
        if (node.tagName === "font") {
          node.tagName = "span";
          props.style = `color:${String(props.color ?? "")};${String(props.style ?? "")}`;
          delete props.color;
        }
        if (typeof props.style === "string") {
          const safe = chronosRichStyle(props.style);
          if (safe) props.dataChronosStyle = safe;
        }
        delete props.style;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

export function chronosRestoreRichText() {
  return (tree: RichNode) => {
    const visit = (node: RichNode) => {
      const props = node.properties;
      if (props && typeof props.dataChronosStyle === "string") {
        const safe = chronosRichStyle(props.dataChronosStyle);
        delete props.dataChronosStyle;
        if (safe) {
          props.style = safe;
          props.dataChronosRich = true;
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
