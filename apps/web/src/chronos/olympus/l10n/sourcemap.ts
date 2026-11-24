import type { Edit } from "./translate.ts";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeDelta(delta: number): string {
  let value = Math.abs(delta) * 2 + Number(delta < 0);
  let result = "";
  do {
    result += alphabet[(value % 32) + (value >= 32 ? 32 : 0)];
    value = Math.floor(value / 32);
  } while (value);
  return result;
}

// Only the first VLQ in each segment is a generated-column delta. Source, original position,
// name and ignore-list information remain valid. Columns inside a changed string stay in it.
function shiftLine(line: string, edits: Pick<Edit, "start" | "end" | "length">[]) {
  let previous = 0, shiftedPrevious = 0, shift = 0, index = 0;
  return line.replace(/[A-Za-z0-9+/]+/g, (segment) => {
    let pos = 0, value = 0, place = 1, digit: number;
    do {
      digit = alphabet.indexOf(segment.charAt(pos++));
      value += (digit % 32) * place;
      place *= 32;
    } while (digit >= 32);
    const delta = Math.floor(value / 2) * (value % 2 ? -1 : 1);
    const column = previous + delta;
    let edit = edits[index];
    while (edit && edit.end <= column) {
      shift += edit.length - (edit.end - edit.start);
      edit = edits[++index];
    }
    const shifted = edit && column > edit.start
      ? edit.start + shift + Math.min(column - edit.start, edit.length)
      : column + shift;
    const shiftedDelta = shifted - shiftedPrevious;
    previous = column;
    shiftedPrevious = shifted;
    return shiftedDelta === delta ? segment : encodeDelta(shiftedDelta) + segment.slice(pos);
  });
}

export function shiftMappings(mappings: string, code: string, edits: Edit[]): string {
  if (!edits.length) return mappings;
  const lines = mappings.split(";");
  const ends = /\r\n|[\r\n\u2028\u2029]/g;
  let nextLine = ends.exec(code);
  let line = 0, lineStart = 0;
  let columns: Pick<Edit, "start" | "end" | "length">[] = [];
  function flush() {
    const current = lines[line];
    if (columns.length && current) lines[line] = shiftLine(current, columns);
    columns = [];
  }
  for (const edit of edits) {
    while (nextLine && nextLine.index < edit.start) {
      flush();
      line++;
      lineStart = ends.lastIndex;
      nextLine = ends.exec(code);
    }
    let start = edit.start;
    // Reordered slots can contain multiline JS. Each translation preserves slot multiplicity.
    const replacementLines = nextLine && nextLine.index < edit.end ? edit.text.split(/\r\n|[\r\n\u2028\u2029]/u) : undefined;
    let i = 0;
    while (nextLine && nextLine.index < edit.end) {
      const replacement = replacementLines?.[i++];
      if (replacement === undefined) throw new Error("Lost line in Olympus source map");
      columns.push({ start: start - lineStart, end: nextLine.index - lineStart, length: replacement.length });
      flush();
      line++;
      start = lineStart = ends.lastIndex;
      nextLine = ends.exec(code);
    }
    if (replacementLines && i !== replacementLines.length - 1) throw new Error("Changed line count in Olympus source map");
    columns.push({ start: start - lineStart, end: edit.end - lineStart, length: replacementLines?.[i]?.length ?? edit.length });
  }
  flush();
  return lines.join(";");
}
