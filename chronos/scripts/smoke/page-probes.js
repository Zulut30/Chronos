// Browser-side probe helpers executed inside Chronos via CDP Runtime.evaluate.
// Loaded from disk by smoke.mjs (never passed inline through shell arguments).
(async function chronosSmokeProbe(action, arg) {
  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "CODE",
    "PRE",
    "KBD",
    "SAMP",
    "SVG",
    "TEXTAREA",
  ]);

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    let cur = el;
    while (cur && cur.nodeType === 1) {
      if (SKIP_TAGS.has(cur.tagName)) return false;
      if (cur.hasAttribute("hidden") || cur.getAttribute("aria-hidden") === "true" || cur.inert) {
        return false;
      }
      const st = getComputedStyle(cur);
      if (st.display === "none" || st.visibility === "hidden" || parseFloat(st.opacity) === 0) {
        return false;
      }
      cur = cur.parentElement;
    }
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    if (r.width <= 1 && r.height <= 1 && st.overflow === "hidden") return false;
    return true;
  }

  function isElementVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    let cur = el;
    while (cur && cur.nodeType === 1) {
      if (cur.hasAttribute("hidden") || cur.getAttribute("aria-hidden") === "true" || cur.inert) {
        return false;
      }
      const st = getComputedStyle(cur);
      if (st.display === "none" || st.visibility === "hidden" || parseFloat(st.opacity) === 0) {
        return false;
      }
      cur = cur.parentElement;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function getVisibleText(root) {
    const base = root || document.body;
    if (!base) return "";
    const parts = [];
    const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || !isVisible(parent)) continue;
      const t = (node.nodeValue || "").replace(/\s+/g, " ").trim();
      if (t) parts.push(t);
    }
    return parts.join("\n");
  }

  function countLatinWords(text) {
    if (/[А-Яа-яЁё]/.test(text)) return 0;
    // Strip URLs and emails before tokenizing.
    const cleaned = text
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, " ");
    const rawTokens = cleaned.split(/[\s·/:—–(),;[\]{}!?""«»]+/).filter(Boolean);
    let words = 0;
    let longWords = 0;
    for (const tok of rawTokens) {
      // Skip domains (e.g. Scrape.do) and dotted version/model identifiers (e.g. GPT-6.2-Sol, v0.1.10).
      if (tok.includes(".")) continue;
      // Skip pure numbers or duration units (5d, 16h, 30m, 25%).
      if (/^\d+(?:[dhms%]|ms|px|rem|em)?$/i.test(tok)) continue;
      // Handle leading number-hyphen compounds like "5-hour" -> "hour".
      const candidate = tok.replace(/^\d+-/, "");
      if (/^[A-Za-z][A-Za-z'’-]*$/.test(candidate)) {
        words += 1;
        if (candidate.length >= 2) longWords += 1;
      } else if (/^[A-Za-z]+_[A-Za-z0-9_]+$/.test(candidate)) {
        // Identifiers like CURSOR_API_KEY count as one token only when part of a phrase.
        words += 1;
        longWords += 1;
      }
    }
    return longWords >= 1 ? words : 0;
  }

  function matchesAllowed(phrase, allowedList) {
    for (const rule of allowedList || []) {
      if (typeof rule === "string") {
        if (phrase === rule) return true;
      } else if (rule && typeof rule === "object" && typeof rule.pattern === "string") {
        try {
          if (new RegExp(rule.pattern).test(phrase)) return true;
        } catch {
          // Ignore malformed regex in config.
        }
      }
    }
    return false;
  }

  function evaluateAssertion(spec) {
    if (spec.anyOf && Array.isArray(spec.anyOf)) {
      const sub = spec.anyOf.map(evaluateAssertion);
      const passed = sub.some((r) => r.ok);
      return {
        ok: passed,
        label: spec.label || "anyOf",
        detail: passed ? "matched one of alternatives" : sub.map((r) => r.detail).join("; "),
      };
    }

    const scopeEl = spec.scope ? document.querySelector(spec.scope) : document.body;
    if (spec.scope && !scopeEl) {
      return {
        ok: false,
        label: spec.label || spec.text || spec.selector || "assertion",
        detail: `scope not found: ${spec.scope}`,
      };
    }

    if (spec.activeSettingsSection) {
      const nav = document.querySelector('nav[data-workspace-area="settings-nav"]');
      const active = [...(nav?.querySelectorAll('button:is([data-active="true"],[aria-current="page"])') || [])];
      const ok = active.length === 1 && active[0].matches(spec.activeSettingsSection) &&
        active[0].matches('[data-active="true"][aria-current="page"]');
      return { ok, label: "Активный раздел настроек", detail: `active: ${active.map(b => b.textContent.trim()).join(", ")}` };
    }

    if (spec.selector) {
      const nodes = [...(scopeEl || document).querySelectorAll(spec.selector)];
      const wantVisible = spec.visible !== false;
      const matched = wantVisible ? nodes.some(isElementVisible) : nodes.length > 0;
      return {
        ok: matched,
        label: spec.label || `selector ${spec.selector}`,
        detail: matched
          ? `found (${nodes.length})`
          : nodes.length > 0
            ? `found ${nodes.length} node(s) for ${spec.selector}, none visible`
            : `not found: ${spec.selector}`,
      };
    }

    if (spec.iframeSrcPrefix) {
      const frames = [...(scopeEl || document).querySelectorAll("iframe")];
      const match = frames.find(
        (f) => isElementVisible(f) && String(f.getAttribute("src") || f.src || "").startsWith(spec.iframeSrcPrefix),
      );
      return {
        ok: Boolean(match),
        label: spec.label || `iframe ${spec.iframeSrcPrefix}`,
        detail: match
          ? `iframe visible (${Math.round(match.getBoundingClientRect().width)}x${Math.round(match.getBoundingClientRect().height)})`
          : `visible iframe with src starting "${spec.iframeSrcPrefix}" not found`,
      };
    }

    if (spec.ariaLabel) {
      const nodes = [...(scopeEl || document).querySelectorAll("[aria-label]")];
      const match = nodes.find((el) => isElementVisible(el) && el.getAttribute("aria-label") === spec.ariaLabel);
      return {
        ok: Boolean(match),
        label: spec.label || `aria-label "${spec.ariaLabel}"`,
        detail: match ? "visible" : `visible element with aria-label="${spec.ariaLabel}" not found`,
      };
    }

    if (spec.ariaLabelPrefix) {
      const nodes = [...(scopeEl || document).querySelectorAll("[aria-label]")];
      const match = nodes.find(
        (el) => isElementVisible(el) && String(el.getAttribute("aria-label") || "").startsWith(spec.ariaLabelPrefix),
      );
      return {
        ok: Boolean(match),
        label: spec.label || `aria-label prefix "${spec.ariaLabelPrefix}"`,
        detail: match ? `visible ("${match.getAttribute("aria-label")}")` : `not found`,
      };
    }

    if (spec.text) {
      const visibleText = getVisibleText(scopeEl);
      const ok = visibleText.includes(spec.text);
      return {
        ok,
        label: spec.label || `text "${spec.text}"`,
        detail: ok ? "visible text matched" : `text "${spec.text}" not visible`,
      };
    }

    return { ok: false, label: spec.label || "unknown", detail: "unsupported assertion spec" };
  }

  switch (action) {
    case "appInfo": {
      let updateState = null;
      let branding = null;
      try {
        updateState = await globalThis.desktopBridge?.getUpdateState?.();
      } catch {
        // Ignore bridge unavailability.
      }
      try {
        branding = await globalThis.desktopBridge?.getAppBranding?.();
      } catch {
        // Ignore bridge unavailability.
      }
      return {
        href: location.href,
        title: document.title,
        pathname: globalThis.__TSR_ROUTER__?.state?.location?.pathname ?? null,
        hasRouter: typeof globalThis.__TSR_ROUTER__?.navigate === "function",
        hasOlyCore: Boolean(globalThis.__olyCore),
        bodyTextLength: (document.body?.innerText || "").trim().length,
        version: updateState?.currentVersion ?? null,
        channel: updateState?.channel ?? null,
        appArch: updateState?.appArch ?? null,
        branding,
        visibilityState: document.visibilityState,
        dark: document.documentElement.classList.contains("dark"),
        themeId: document.documentElement.getAttribute("data-theme-id"),
        bodyBackground: document.body ? getComputedStyle(document.body).backgroundColor : null,
      };
    }

    case "checkGlobals": {
      const expected = Array.isArray(arg?.expected) ? arg.expected : [];
      const allOly = Object.keys(globalThis)
        .filter((k) => k.startsWith("__oly"))
        .sort();
      const expectedSet = new Set(expected);
      const missing = expected.filter(
        (k) => typeof globalThis[k] === "undefined" || globalThis[k] === null,
      );
      const extra = allOly.filter((k) => !expectedSet.has(k));
      return {
        ok: missing.length === 0,
        expectedCount: expected.length,
        presentCount: expected.length - missing.length,
        totalOlyGlobals: allOly.length,
        missing,
        extra,
        present: allOly,
      };
    }

    case "checkScheme": {
      const indexUrl = arg?.indexUrl || "/index.html";
      const wasmCfg = arg?.wasmDiscovery || { enabled: true, minCount: 1, checkMagic: true };
      const indexResp = await fetch(indexUrl, { cache: "no-store" });
      const indexHtml = await indexResp.text();
      const indexResult = {
        url: indexUrl,
        status: indexResp.status,
        ok: indexResp.status === 200 && indexHtml.length > 0,
        bytes: indexHtml.length,
      };

      const wasmUrls = new Set();
      let scriptsScanned = 0;
      if (wasmCfg.enabled !== false) {
        const initial = [
          ...indexHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g),
        ].map((m) => m[1]);
        const visited = new Set();
        const priorityQueue = [...new Set(initial)];
        const fallbackQueue = [];
        const interestingRe = /main-|_chat-|ThreadTerminal|Terminal|ghostty|ChatView/i;

        const scanQueue = async (queue, maxVisited, collectFallback) => {
          while (queue.length > 0 && wasmUrls.size === 0 && visited.size < maxVisited) {
            const url = queue.shift();
            if (!url || visited.has(url)) continue;
            visited.add(url);
            scriptsScanned += 1;
            try {
              const r = await fetch(url);
              if (!r.ok) continue;
              const txt = await r.text();
              const wasms = txt.match(/(?:\/|\.\/)?assets\/[A-Za-z0-9._-]+\.wasm/g) || [];
              for (const w of wasms) {
                wasmUrls.add("/" + w.replace(/^\.?\/+/, ""));
              }
              const jsRefs = [
                ...new Set((txt.match(/assets\/[A-Za-z0-9._-]+\.js/g) || []).map((x) => "/" + x)),
              ];
              for (const ref of jsRefs) {
                if (visited.has(ref)) continue;
                if (interestingRe.test(ref)) {
                  queue.push(ref);
                } else if (collectFallback) {
                  fallbackQueue.push(ref);
                }
              }
            } catch {
              // Continue scanning other chunks.
            }
          }
        };

        await scanQueue(priorityQueue, 30, true);
        if (wasmUrls.size === 0) {
          for (const entry of performance.getEntriesByType("resource")) {
            if (entry.name.includes("/assets/") && entry.name.endsWith(".js")) {
              const p = new URL(entry.name).pathname;
              if (!visited.has(p)) fallbackQueue.unshift(p);
            }
          }
          await scanQueue(fallbackQueue, 80, false);
        }
      }

      const wasmResults = [];
      for (const url of [...wasmUrls].sort()) {
        try {
          const r = await fetch(url, { cache: "no-store" });
          const buf = new Uint8Array(await r.arrayBuffer());
          const magic = [...buf.slice(0, 4)];
          const validMagic =
            magic.length === 4 &&
            magic[0] === 0 &&
            magic[1] === 97 &&
            magic[2] === 115 &&
            magic[3] === 109;
          wasmResults.push({
            url,
            status: r.status,
            bytes: buf.length,
            validMagic,
            ok: r.status === 200 && buf.length > 0 && (!wasmCfg.checkMagic || validMagic),
          });
        } catch (err) {
          wasmResults.push({
            url,
            status: 0,
            bytes: 0,
            validMagic: false,
            ok: false,
            error: String(err?.message || err),
          });
        }
      }

      const minCount = wasmCfg.minCount ?? 1;
      const wasmOk =
        wasmCfg.enabled === false ||
        (wasmResults.length >= minCount && wasmResults.every((w) => w.ok));

      return {
        ok: indexResult.ok && wasmOk,
        index: indexResult,
        wasm: wasmResults,
        discoveredCount: wasmResults.length,
        scriptsScanned,
      };
    }

    case "dismissOnboarding": {
      const pathname = globalThis.__TSR_ROUTER__?.state?.location?.pathname ?? "";
      const isWelcome = pathname === "/welcome" || location.hash.startsWith("#/welcome");
      if (!isWelcome) return { wasWelcome: false, clicked: false };
      const buttons = [...document.querySelectorAll("button")].filter(
        (b) => isElementVisible(b) && !b.disabled,
      );
      const target =
        buttons.find((b) => /Начать без агента|Start without an agent/i.test(b.innerText || "")) ||
        buttons.find((b) => /Пропустить|Skip/i.test(b.innerText || "")) ||
        (arg?.readyProvider && buttons.find((b) => /^(?:Начать|Запустить|Start)$/i.test(b.innerText.trim())));
      if (!target) {
        return {
          wasWelcome: true,
          clicked: false,
          buttons: buttons.map((b) => (b.innerText || "").trim()).filter(Boolean).slice(0, 10),
        };
      }
      target.click();
      return { wasWelcome: true, clicked: true, clickedText: (target.innerText || "").trim() };
    }

    case "ensureDraft": {
      const start = [...document.querySelectorAll("button")].find((button) =>
        isElementVisible(button) && !button.disabled &&
        /^(?:(?:или )?начать без проекта|(?:or )?start without a project)$/i.test(button.innerText.trim())
      );
      if (start) {
        start.click();
        return true;
      }
      return isElementVisible(document.querySelector("[data-slot=composer-host]"));
    }

    case "performAction": {
      const spec = arg || {};
      if (spec.type === "navigate") {
        if (!globalThis.__TSR_ROUTER__?.navigate) {
          return { ok: false, detail: "__TSR_ROUTER__.navigate is not available" };
        }
        await globalThis.__TSR_ROUTER__.navigate({ to: spec.to });
        return { ok: true, detail: `navigated to ${spec.to}` };
      }
      if (spec.type === "click") {
        const nodes = [...document.querySelectorAll(spec.selector)];
        const target = nodes.find(isElementVisible) || nodes[0];
        if (!target) {
          return { ok: Boolean(spec.optional), detail: `click target not found: ${spec.selector}` };
        }
        target.click();
        return { ok: true, detail: `clicked ${spec.selector}` };
      }
      if (spec.type === "closeOlympus") {
        const fn = globalThis[spec.global]?.[spec.method || "close"];
        if (typeof fn === "function") {
          fn();
          return { ok: true, detail: `called ${spec.global}.${spec.method || "close"}()` };
        }
        return { ok: true, detail: `${spec.global}.${spec.method || "close"} not present` };
      }
      if (spec.type === "escape") {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return { ok: true, detail: "dispatched Escape" };
      }
      return { ok: false, detail: `unknown action type: ${spec.type}` };
    }

    case "getThemeState": {
      return {
        dark: document.documentElement.classList.contains("dark"),
        themeId: document.documentElement.getAttribute("data-theme-id"),
        bg: document.body ? getComputedStyle(document.body).backgroundColor : null,
      };
    }

    case "freezeInfiniteAnimations": {
      let frozen = 0;
      for (const anim of document.getAnimations({ subtree: true })) {
        const timing = anim.effect?.getTiming?.();
        if (timing && timing.iterations === Infinity) {
          try {
            anim.pause();
            anim.currentTime = 0;
            frozen += 1;
          } catch {
            // Ignore read-only animation timelines.
          }
        }
      }
      return { frozen };
    }

    case "resumeInfiniteAnimations": {
      let resumed = 0;
      for (const anim of document.getAnimations({ subtree: true })) {
        const timing = anim.effect?.getTiming?.();
        if (timing && timing.iterations === Infinity && anim.playState === "paused") {
          try {
            anim.play();
            resumed += 1;
          } catch {
            // Ignore read-only animation timelines.
          }
        }
      }
      return { resumed };
    }

    case "checkReady": {
      const w = arg || {};
      for (const assertion of w.assertions || []) {
        const result = evaluateAssertion(assertion);
        if (!result.ok) return { ready: false, detail: result.detail };
      }
      if (w.selector) {
        const ok = [...document.querySelectorAll(w.selector)].some(isElementVisible);
        if (!ok) return { ready: false, detail: `waiting for selector ${w.selector}` };
      }
      if (Array.isArray(w.allSelectors)) {
        for (const sel of w.allSelectors) {
          if (![...document.querySelectorAll(sel)].some(isElementVisible)) {
            return { ready: false, detail: `waiting for selector ${sel}` };
          }
        }
      }
      if (w.text) {
        const visibleText = getVisibleText(document.body);
        if (!visibleText.includes(w.text)) {
          return { ready: false, detail: `waiting for text "${w.text}"` };
        }
      }
      return { ready: true, detail: "ready" };
    }

    case "inspectScreen": {
      const cfg = arg || {};
      const expectList = Array.isArray(cfg.expect) ? cfg.expect : [];
      const assertions = expectList.map(evaluateAssertion);

      const failedAssertions = assertions.filter((a) => !a.ok);

      // Visible English phrases (>=2 Latin words outside excluded selectors).
      const excludeSelectors = [
        ...(cfg.englishScan?.excludeSelectors || []),
        ...(cfg.excludeEnglishSelectors || []),
      ].filter(Boolean);
      const excludeQuery = excludeSelectors.length > 0 ? excludeSelectors.join(",") : null;
      const allowedRules = [
        ...(cfg.englishScan?.allowedGlobal || []),
        ...(cfg.allowedEnglish || []),
      ];

      const cleanComposer = cfg.cleanProfile
        ? document.querySelector("[data-chat-provider-unavailable]")?.closest("[data-slot=composer-host]")
        : null;
      const unexpected = new Set();
      const phraseSet = new Set();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = (node.nodeValue || "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        const parent = node.parentElement;
        if (!parent) continue;
        if (excludeQuery && parent.closest(excludeQuery)) continue;
        if (!isVisible(parent)) continue;
        if (countLatinWords(text) >= 2) {
          phraseSet.add(text);
          const expectedInComposer = cleanComposer?.contains(parent) && cfg.englishScan?.cleanComposerEnglish?.includes(text);
          if (!expectedInComposer && !matchesAllowed(text, allowedRules)) unexpected.add(text);
        }
      }

      const englishPhrases = [...phraseSet].sort();
      const unexpectedEnglishPhrases = [...unexpected].sort();

      // Measure dynamic pixel mask bounding boxes in viewport coordinates.
      const vw = window.innerWidth || 1400;
      const vh = window.innerHeight || 900;
      const dynamicMasks = [];
      const seenBoxes = new Set();
      const maskSelectors = Array.isArray(cfg.maskSelectors) ? cfg.maskSelectors : [];
      for (const sel of maskSelectors) {
        let els = [];
        try {
          els = [...document.querySelectorAll(sel)];
        } catch {
          continue;
        }
        for (const el of els) {
          if (!isElementVisible(el)) continue;
          const r = el.getBoundingClientRect();
          const pad = 2;
          const x = Math.max(0, Math.floor(r.left) - pad);
          const y = Math.max(0, Math.floor(r.top) - pad);
          const x2 = Math.min(vw, Math.ceil(r.right) + pad);
          const y2 = Math.min(vh, Math.ceil(r.bottom) + pad);
          if (x2 > x && y2 > y) {
            const key = `${x},${y},${x2 - x},${y2 - y}`;
            if (!seenBoxes.has(key)) {
              seenBoxes.add(key);
              dynamicMasks.push({
                x,
                y,
                width: x2 - x,
                height: y2 - y,
                selector: sel,
              });
            }
          }
        }
      }

      return {
        ok: failedAssertions.length === 0,
        pathname: globalThis.__TSR_ROUTER__?.state?.location?.pathname ?? null,
        theme: {
          dark: document.documentElement.classList.contains("dark"),
          themeId: document.documentElement.getAttribute("data-theme-id"),
          bg: document.body ? getComputedStyle(document.body).backgroundColor : null,
        },
        assertions,
        failedAssertions,
        englishPhrases,
        unexpectedEnglishPhrases,
        dynamicMasks,
      };
    }

    default:
      throw new Error(`Unknown chronosSmokeProbe action: ${action}`);
  }
});
