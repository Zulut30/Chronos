import { expect, it } from "vite-plus/test";
import { chronosMarkdownRichTree, chronosRichStyle } from "./markdownPipeline";

it("keeps allowed rich formatting while rejecting CSS execution, forged markers and scripts", () => {
  const tree = JSON.stringify(
    chronosMarkdownRichTree(
      '<span style="color:red;background:yellow;font-weight:bold;position:fixed;background-image:url(https://evil)">цвет</span><mark>метка</mark><u>линия</u><script>alert(1)</script><span data-chronos-style="color:blue" onclick="evil()">подмена</span>',
    ),
  );
  expect(tree).toContain("var(--chronos-c-red,red)");
  expect(tree).toContain("var(--chronos-bg-yellow,yellow)");
  expect(tree).toContain("font-weight:bold");
  expect(tree).toContain('"tagName":"mark"');
  expect(tree).toContain('"tagName":"u"');
  for (const unsafe of ["fixed", "https://evil", "onclick", "alert(1)", "color:blue"])
    expect(tree).not.toContain(unsafe);
});

it("keeps rich HTML inside fenced and inline code literal", () => {
  const tree = JSON.stringify(
    chronosMarkdownRichTree(
      '`<span style="color:red">code</span>`\n\n```html\n<mark>code</mark>\n```',
    ),
  );
  expect(tree).not.toContain("dataChronosRich");
  expect(tree).toContain("color:red");
  expect(tree).toContain("<mark>code</mark>");
});

it("exports fixed light palette colors for clipboard HTML and accepts only safe CSS values", () => {
  expect(
    chronosRichStyle(
      "color:var(--chronos-c-red,red);background:yellow;font-style:italic;text-decoration:underline",
      true,
    ),
  ).toBe("color:#C62828;background-color:#efe9d6;font-style:italic;text-decoration:underline");
  expect(
    chronosRichStyle("color:var(--secret);background:url(x);width:999px;color:expression(x)"),
  ).toBe("");
});
