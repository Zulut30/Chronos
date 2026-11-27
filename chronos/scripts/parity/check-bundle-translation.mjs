import * as NodeFS from "node:fs";
import { stripVTControlCharacters } from "node:util";

// Match the old occurrence at its use site. A second identical English label is still new.
const zip = ["previewFailureMessages", "binaryPreview.worker", "document.worker", "imageDecode.worker",
  "largeText.worker", "officePreview.worker", "presentation.worker", "spreadsheet.worker"];
const expected = [
  ...zip.map(chunk => [[chunk], "broad", "Preview limited to files under 50 MB.", '"file-too-large":']),
  // paletteSearch.ts can be shared by either chunk. Consume this source occurrence only once.
  [["projectGrouping", "threadSearch"], "label", "Project", 'field:`project`,label:`Project`,text:'],
  [["utils"], "broad", "File comment", 'new Map([[`File comment`,'],
];
const log = stripVTControlCharacters(NodeFS.readFileSync(process.argv[2], "utf8"));
const summary = [...log.matchAll(/Remaining English occurrences: (\d+); replacements:/g)];
if (summary.length !== 1 || log.includes("Expected one chunk containing src/main.tsx")) {
  throw Error("Missing or ambiguous Olympus translation pass / runtime host");
}
const lines = [...log.matchAll(/(?:^|\n)[^\n]*?(assets\/([^/\n]+?)-[\w-]+\.js@\d+) (\w+) ("(?:\\.|[^"\\])*") \(([^)]+)\) ("(?:\\.|[^"\\])*")/g)];
if (lines.length !== Number(summary[0][1])) throw Error("Incomplete Olympus translation diagnostics: " + lines.length + "/" + summary[0][1]);
for (const [, where, chunk, table, literal, reason, snippet] of lines) {
  const key = JSON.parse(literal), context = JSON.parse(snippet);
  const index = expected.findIndex(([chunks, group, text, marker]) =>
    chunks.includes(chunk) && group === table && text === key && context.includes(marker) && reason === "unrecognized or ambiguous usage");
  if (index >= 0) expected.splice(index, 1);
  else {
    console.error("Olympus translation:", where, table, literal, reason, context);
    process.exitCode = 1;
  }
}
console.log("Reviewed bundle occurrences:", lines.length);
