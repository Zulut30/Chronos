import { expect, it } from "vite-plus/test";

import { applyThemeCss } from "./themeCss";

it("applies the Olympus 4774 limit row layout to the 5209 usage link", () => {
  const card = document.createElement("div");
  card.dataset.threadDetailsCard = "";
  card.innerHTML = '<section><h3 id="thread-details-usage-heading"></h3><div><a tabindex="0" href="/usage"><span>25%</span></a></div></section>';
  document.body.append(card);
  using _card = { [Symbol.dispose]: () => card.remove() };
  using _css = { [Symbol.dispose]: () => applyThemeCss(undefined) };
  const section = "[data-thread-details-card] section:has(#thread-details-usage-heading,#thread-details-context-heading)";
  applyThemeCss(`
    ${section}>div:last-child>div[tabindex]{display:grid;grid-template-areas:"l r v" "b b b"}
    ${section} div[tabindex]>span{grid-area:v}
  `);
  expect(getComputedStyle(card.querySelector("a")!).gridTemplateAreas).toBe('"l r v" "b b b"');
  expect(getComputedStyle(card.querySelector("span")!).gridArea).toBe("v");
});

it("applies theme CSS and drops every rule that would load a remote file", () => {
  const probe = document.createElement("div");
  probe.dataset.themeCssProbe = "";
  document.body.append(probe);
  using _probe = { [Symbol.dispose]: () => probe.remove() };
  using _css = { [Symbol.dispose]: () => applyThemeCss(undefined) };

  applyThemeCss(`
    @import url(https://example.com/sheet.css);
    @namespace svg url(http://www.w3.org/2000/svg);
    @property --registered { syntax: "<url>"; inherits: false; initial-value: url(https://example.com/d); }
    @counter-style leak { system: cyclic; symbols: url(https://example.com/f); }
    @keyframes leak { to { background-image: url(https://example.com/g); } }
    :root { --leak: u\\72l(https://example.com/a); }
    [data-theme-css-probe] {
      color: rgb(1, 2, 3);
      background-image: u\\72l(https://example.com/b);
      list-style-image: var(--leak);
      border-image-source: var(--registered);
      mask-image: v\\61r(--none, u\\72l(https://example.com/e));
      @media (min-width: 0px) { cursor: url(https://example.com/c), auto; }
    }
    [data-theme-css-probe] { background: var(--none, url(https://example.com/h)); }
    @keyframes shorthand { to { border-image: var(--none, url(https://example.com/i)); } }
    [data-workspace-area="conversation"] { background: var(--theme-background-image) center / cover no-repeat; }
  `);

  const style = getComputedStyle(probe);
  expect(style.color).toBe("rgb(1, 2, 3)");
  expect(style.backgroundImage).toBe("none");
  expect(style.listStyleImage).toBe("none");
  expect(style.borderImageSource).toBe("none");
  expect(style.maskImage).toBe("none");
  const themeCssText = () =>
    document.adoptedStyleSheets
      .flatMap((sheet) => Array.from(sheet.cssRules, (rule) => rule.cssText))
      .join("\n");
  expect(themeCssText()).not.toContain("example.com");
  expect(themeCssText()).toContain(
    "background: var(--theme-background-image) center / cover no-repeat;",
  );
  expect(style.cursor).toBe("auto");

  // A later longhand hides the shorthand's text from CSSOM, and the browser still loads its url().
  applyThemeCss(`
    [data-theme-css-probe] { mask: v\\61r(--none, u\\72l(https://example.com/k)); mask-size: auto; }
    [data-theme-css-probe] { list-style: env(t3-none, url(https://example.com/l)); list-style-type: disc; }
    @keyframes hidden { to { background: var(--none, url(https://example.com/m)); background-color: red; } }
    [data-theme-css-probe] { border-image: var(--none, url(https://example.com/n)); border-image-slice: 1; }
    [data-theme-css-probe] { animation: hidden 1s forwards paused; animation-delay: -1s; }
  `);
  expect(style.maskImage).toBe("none");
  expect(style.listStyleImage).toBe("none");
  expect(style.borderImageSource).toBe("none");
  expect(style.backgroundImage).toBe("none");
  expect(style.backgroundColor).toBe("rgb(255, 0, 0)");

  // Every function that names a file is refused, in a font face and behind `all` too.
  applyThemeCss(`
    @font-face { font-family: remote; src: url(https://example.com/o.woff2); }
    [data-theme-css-probe] { background: var(--none, image-set("https://example.com/p" 1x)); background-color: red; }
    [data-theme-css-probe] { mask: var(--none, -webkit-cross-fade(url(https://example.com/q), url(https://example.com/r), 50%)); mask-size: auto; }
    [data-theme-css-probe] { all: var(--none, url(https://example.com/s)); font-size: 12px; }
    body { [data-theme-css-probe] { list-style: if(style(--none: 1): none; else: url(https://example.com/t)); list-style-type: disc; } }
  `);
  expect(themeCssText()).not.toContain("example.com");
  expect(style.backgroundImage).toBe("none");
  expect(style.maskImage).toBe("none");
  expect(style.listStyleImage).toBe("none");

  // The same shape without a fetch stays, whatever the rest of the sheet holds.
  applyThemeCss(`
    [data-theme-css-probe] {
      --edge: 4px solid red; border: var(--edge); border-left-width: 0;
      background: var(--none, linear-gradient(red, blue)); background-color: red;
    }
    .unused { c\\6flor: red; b\\61 ckground: var(--none); cursor: url(https://example.com/x), auto; }
    .unused { background: var(--none, url(https://example.com/y)); background-size: auto; }
  `);
  expect(themeCssText()).not.toContain("example.com");
  expect(style.borderTopWidth).toBe("4px");
  expect(style.borderLeftWidth).toBe("0px");
  expect(style.backgroundImage).toContain("linear-gradient");

  applyThemeCss(undefined);
  expect(getComputedStyle(probe).color).not.toBe("rgb(1, 2, 3)");
});

it("unifies Olympus dark typography, removes serif fallbacks, sets auto smoothing, and translates plan menu header in English", () => {
  const root = document.documentElement;
  const prevTheme = root.dataset.themeId;
  const prevDark = root.classList.contains("dark");
  const prevLang = root.getAttribute("lang");
  const prevSmoothing = root.style.getPropertyValue("-webkit-font-smoothing");

  const host = document.createElement("div");
  host.innerHTML = `
    <div class="chat-markdown"><h1>Аудит типографики</h1></div>
    <div data-thread-details-card><section><h3 id="thread-details-usage-heading">Лимиты</h3></section></div>
    <div class="oly-plan-menu"></div>
    <span class="font-light" data-thin-probe>Тонкий текст</span>
  `;
  document.body.append(host);
  using _cleanup = {
    [Symbol.dispose]: () => {
      host.remove();
      applyThemeCss(undefined);
      if (prevTheme === undefined) delete root.dataset.themeId;
      else root.dataset.themeId = prevTheme;
      root.classList.toggle("dark", prevDark);
      if (prevLang === null) root.removeAttribute("lang");
      else root.setAttribute("lang", prevLang);
      if (prevSmoothing) root.style.setProperty("-webkit-font-smoothing", prevSmoothing);
      else root.style.removeProperty("-webkit-font-smoothing");
    },
  };

  root.dataset.themeId = "olympus-night";
  root.classList.add("dark");
  root.setAttribute("lang", "en");
  root.style.setProperty("-webkit-font-smoothing", "antialiased");

  applyThemeCss(`
    :root.dark .chat-markdown h1 { font-family: Didot, "Bodoni 72", Georgia, serif; text-transform: uppercase; }
    :root.dark [data-thread-details-card] section h3 { font-family: Didot, "Cormorant Garamond", Georgia, serif; font-size: 10px; text-transform: uppercase; }
    :root.dark .oly-plan-menu::before { content: "Режим ответа"; font-family: Didot, Georgia, serif; }
  `);

  const h1Style = getComputedStyle(host.querySelector("h1")!);
  const usageHeadingStyle = getComputedStyle(host.querySelector("#thread-details-usage-heading")!);
  const menuBefore = getComputedStyle(host.querySelector(".oly-plan-menu")!, "::before");
  const thinStyle = getComputedStyle(host.querySelector("[data-thin-probe]")!);

  expect(h1Style.fontFamily).not.toMatch(/Georgia|Didot|Bodoni|Cormorant|Times/i);
  expect(h1Style.textTransform).toBe("none");
  expect(usageHeadingStyle.fontFamily).not.toMatch(/Georgia|Didot|Bodoni|Cormorant|Times/i);
  expect(usageHeadingStyle.textTransform).toBe("none");
  expect(Number.parseFloat(usageHeadingStyle.fontSize)).toBeGreaterThanOrEqual(12);
  expect(menuBefore.content).toBe('"Response mode"');
  expect(menuBefore.fontFamily).not.toMatch(/Georgia|Didot|Bodoni|Cormorant|Times/i);
  expect(getComputedStyle(root).getPropertyValue("-webkit-font-smoothing")).toBe("auto");
  expect(Number(thinStyle.fontWeight)).toBeGreaterThanOrEqual(400);
});
