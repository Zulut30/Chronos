import { expect, it } from "vite-plus/test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { modelMatchesKind, modelReference, MEDIA_KINDS } from "./Panels";
import { remarkChronosTaskReferences } from "./taskReferences";

it("serializes every OpenRouter kind to the existing MCP tool without starting a generation", () => {
  for (const kind of Object.keys(MEDIA_KINDS) as (keyof typeof MEDIA_KINDS)[]) {
    expect(modelReference({ id: "provider/model" }, kind)).toBe(
      `@openrouter:provider/model (${MEDIA_KINDS[kind][2]}; MCP openrouter → ${MEDIA_KINDS[kind][1]})`,
    );
  }
  const audio = {
    id: "audio",
    architecture: { input_modalities: ["audio"], output_modalities: ["text"] },
  };
  expect(modelMatchesKind(audio, "transcription")).toBe(true);
  expect(modelMatchesKind(audio, "image")).toBe(false);
  expect(
    modelMatchesKind({ id: "image", architecture: { output_modalities: ["image"] } }, "image"),
  ).toBe(true);
});

it("makes task references actionable without rewriting code or existing links", () => {
  const processor = unified().use(remarkParse).use(remarkChronosTaskReferences);
  const tree = JSON.stringify(
    processor.runSync(
      processor.parse("Открыть #T-12, `#T-13` и [#T-14](https://example.com).\n\n```\n#T-15\n```"),
    ),
  );
  expect(tree).toContain("https://chronos.invalid/tasks/T-12");
  expect(tree).not.toContain("https://chronos.invalid/tasks/T-13");
  expect(tree).not.toContain("https://chronos.invalid/tasks/T-14");
  expect(tree).not.toContain("https://chronos.invalid/tasks/T-15");
  expect(tree).toContain("https://example.com");
});
