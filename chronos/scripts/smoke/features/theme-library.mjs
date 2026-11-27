import assert from "node:assert/strict";
import { mkdtempSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function verifyThemeLibrary({ client, evaluate, until }) {
  await until("published Olympus", () => evaluate("!!document.querySelector('[data-theme-library-card=olympus]')"));
  const original = await evaluate("JSON.parse(localStorage.getItem('t3code:environment-themes:v1')).find(t=>t.id==='olympus')");
  assert.ok(original?.variants?.dark || original?.variants?.light);
  // Import the same exported file twice through the settings dialog.
  const exportFile = { version: 1, ...original, id: "smoke-reimport", name: "Reimported Olympus" };
  const storedImports = () => evaluate("localStorage.getItem('t3code:themes:v1')");
  const before = await storedImports();
  const directory = mkdtempSync(join(tmpdir(), "chronos-theme-import-"));
  const file = join(directory, "Reimported Olympus.json");
  const content = JSON.stringify(exportFile);
  try {
    writeFileSync(file, content);
    for (let pass = 0; pass < 2; pass++) {
      const open = await client.probe("performAction", { type: "click", selector: "button", text: "Add theme" });
      assert.ok(open.ok, open.detail);
      const dialog = "document.querySelector('#theme-json-editor')?.closest('[role=dialog]')";
      const fileInput = dialog + "?.querySelector('input[type=file]')";
      await until("theme file chooser", () => evaluate("!!" + fileInput));
      const { result } = await client.send("Runtime.evaluate", { expression: fileInput });
      assert.ok(result.objectId, "missing import dialog file input");
      try {
        await client.send("DOM.setFileInputFiles", { objectId: result.objectId, files: [file] });
      } finally {
        await client.send("Runtime.releaseObject", { objectId: result.objectId });
      }
      const submit = "Array.from(" + dialog + "?.querySelectorAll('button') ?? []).find(b => b.textContent.trim() === 'Add theme' && !b.disabled)";
      // A large stylesheet is read asynchronously. Submit only after the actual file
      // has populated the editor and React has enabled its import action.
      await until("file ready to import", () => evaluate(
        "document.querySelector('#theme-json-editor')?.value.length === " + content.length + " && !!(" + submit + ")"));
      // Settings and its nested importer both offer Add theme. Submit in the editor's own dialog.
      assert.ok(await evaluate("(() => {const button = " + submit + "; if (!button) return false; button.click(); return true})()"));
      await until("reimport selects the published theme", () => evaluate("!document.querySelector('#theme-json-editor') && localStorage.getItem('t3code:theme')==='olympus'"));
      assert.equal(await storedImports(), before, "reimport must not write another theme");
    }
  } finally {
    rmSync(file, { force: true });
    rmdirSync(directory);
  }
  // Simulate older clients with two stored imports and a selected duplicate in both halves.
  // Reload twice to cover hydration as well as a reconnect that republishes the same theme.
  await evaluate("(() => {const theme=" + JSON.stringify(original) + ";const night=theme.appearance==='dark'?theme.colors:theme.variants.dark;const copies=[{...theme,id:'smoke-olympus-a',colors:{...theme.colors,canvas:'#012345'}}, {...theme,id:'smoke-olympus-b',label:'Imported Graphite',appearance:'dark',colors:night,variants:undefined}];localStorage.setItem('t3code:themes:v1',JSON.stringify(copies));localStorage.setItem('t3code:theme',copies[0].id);localStorage.setItem('t3code:theme-halves:v1',JSON.stringify({light:copies[0].id,dark:copies[1].id}));})()");
  for (let pass = 0; pass < 2; pass++) {
    const previousDocument = await evaluate("performance.timeOrigin");
    await client.send("Page.reload");
    await until("theme migration in the new document", () => evaluate(
      `(() => {
        if (performance.timeOrigin === ${JSON.stringify(previousDocument)} || document.readyState === 'loading' ||
            document.documentElement?.lang !== 'en' || !document.querySelector('[data-theme-library-card=olympus]')) return false;
        const halves = JSON.parse(localStorage.getItem('t3code:theme-halves:v1'));
        return localStorage.getItem('t3code:theme') === 'olympus' && halves?.light === 'olympus' && halves?.dark === 'olympus';
      })()`));
    const ids = await evaluate("Array.from(document.querySelectorAll('[data-theme-library-card]'),e=>e.dataset.themeLibraryCard)");
    assert.equal(new Set(ids).size, ids.length);
    assert(!ids.includes("smoke-olympus-b"));
    await until("redundant Graphite import removed from storage", async () =>
      !JSON.parse((await storedImports()) || "[]").some(theme => theme.id === "smoke-olympus-b"));
    const imports = JSON.parse((await storedImports()) || "[]");
    const edited = imports.find(theme => theme.id === "smoke-olympus-a");
    assert.equal(edited?.label, original.label + " (2)", "distinct edited palette retains a unique name");
    assert.equal(edited.colors.canvas, "#012345");
    await until("renamed edit is selectable", () => evaluate("!!document.querySelector('[data-theme-library-card=smoke-olympus-a]')"));
  }
}
