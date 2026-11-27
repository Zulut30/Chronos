// Chronos typography, weight, smoothing, and WCAG AA contrast layer for Olympus themes
// (Graphite dark, classic night Olympus, and day Olympus; any `data-theme-id` starting with `olympus`).
// Mounted in `document.adoptedStyleSheets` after `themeSheet` so it overrides both theme CSS
// and `<style>` blocks injected by immutable Olympus modules without modifying those modules.
//
// Font smoothing rationale (dark Olympus):
// Upstream defaults `fontSmoothing: true`, setting `-webkit-font-smoothing: antialiased` on `:root`.
// On macOS CoreGraphics, `antialiased` disables optical stem dilation and noticeably thins light text
// on dark surfaces—especially muted captions, warm gold headers, and Cyrillic strokes at 11–13px
// and on 1x external displays. Dark Olympus already controls halation via soft off-white ink
// (`#EDF0F5` / `#E8F0FB`) on charcoal/navy rather than pure `#FFF` on `#000`, so resetting dark
// Olympus to `-webkit-font-smoothing: auto` preserves readable stem weight on macOS while leaving
// Windows DirectWrite rendering and light/stock themes untouched.

export const OLYMPUS_TYPOGRAPHY_CSS = `
:root[data-theme-id^="olympus"] {
  --sf: var(--font-mono);
  --mono: var(--font-mono);
  --ps-font: var(--font-sans);
  --ps-track: 0;
  --ps-case: none;
  --pr-head: var(--font-sans);
  --pr-tracking: 0;
  --pr-case: none;
  --budget-heading: 600 16px/1.3 var(--font-sans);
  --budget-spacing: 0;
  --budget-case: none;
}

/* Dark Olympus smoothing & minimum weight guard for light text on dark backgrounds. */
:root[data-theme-id^="olympus"].dark {
  -webkit-font-smoothing: auto !important;
  --ps-size: 14px;
  --budget-heading: 600 15px/1.35 var(--font-sans);
}
:root[data-theme-id^="olympus"].dark :is(.font-thin, .font-extralight, .font-light) {
  font-weight: 400;
}

/* Unified sans-serif stack across dark and day Olympus: no Georgia/Didot/Bodoni/Cormorant
   serif fallbacks and no bare "Inter, system-ui" that misses "Inter Variable" on Windows. */
:root[data-theme-id^="olympus"] :is(
  .chat-markdown :is(h1, h2, h3, th, blockquote),
  [data-timeline-row-kind^="pro"] h3,
  [data-slot="dialog-title"],
  [data-settings-scroll-target] h2,
  [data-workspace-area="composer"] h1,
  [data-thread-details-card] section h3,
  [data-thread-details-card] section.oly-bg :is(.oly-bg-head h3, .oly-bg-sum, .oly-bg-row, .oly-bg-ghead, .oly-bg-st),
  .oly-stats :is(h3, .big, tr.grp td),
  .oly-budget-pill,
  .oly-budget-pop :is(h3, button),
  .oly-ftoast-t,
  .oly-notify-wrap,
  .oly-acct,
  .oly-mach-head,
  .oly-mach-keys,
  .oly-or-title,
  .oly-or-count,
  .oly-plan-menu,
  .oly-plan-menu::before,
  .oly-search-menu,
  .oly-prompt-dialog,
  .oly-search-heading,
  .oly-prompt-dialog h2,
  .oly-mode-chip,
  .oly-studio-pop .h b,
  .oly-studio-dialog > header,
  .oly-studio-dialog > header .oly-studio-title,
  .oly-studio-dialog .studio-state,
  .oly-studio-dialog .studio-state :is(b, button),
  .oly-tk-dialog,
  .oly-tk-navtitle,
  .oly-tk-crumb h2,
  .oly-tk-colhead,
  .oly-tk-colhead small,
  .oly-tk-dialog .oly-tk-title,
  .oly-tk-mbox h3,
  .oly-tk-lhead,
  .oly-project-monogram,
  .oly-ik-field input::placeholder,
  .oly-wp-action,
  .oly-wp-action b,
  .oly-wp-pop,
  .oly-wp-pop h2,
  .oly-wp-toast,
  .oly-mcp-pane :is(h2, header button, .oly-mcp-error),
  .oly-pn-zone span,
  .oly-pn-ghost,
  .oly-pn-toast
) {
  font-family: var(--font-sans) !important;
}

/* Unified Cyrillic monospace stack for code, shortcuts, model IDs, and Olympus mono rows. */
:root[data-theme-id^="olympus"] :is(
  [data-slot="command-group-label"],
  [data-slot="kbd"],
  [data-slot="menu-shortcut"],
  [data-slot="command-shortcut"],
  section:has(#thread-details-servers-heading) li > button > span > span:first-child,
  .oly-stats .mdl,
  .oly-bg-row:not([data-type="agent"]):not([data-type="ci"]) .oly-bg-det,
  .oly-tk-meta .id,
  .oly-tk-empty code,
  .oly-tk-dhead .id,
  .oly-tk-md code,
  .oly-tk-opt .id,
  .oly-search-menu kbd,
  .oly-studio-pop .msg code,
  .oly-ik-meta code,
  .oly-ik-field input,
  .oly-ik-tools code,
  .oly-ps-cmd,
  .oly-ps-prefix,
  .oly-skills-msg code
) {
  font-family: var(--font-mono) !important;
}

/* Natural mixed case and balanced heading hierarchy in both dark and day Olympus. */
:root[data-theme-id^="olympus"] .chat-markdown :is(h1, h2, h3) {
  font-weight: 600;
  text-transform: none;
  letter-spacing: -0.015em;
  line-height: 1.3;
}
:root[data-theme-id^="olympus"] .chat-markdown h1 {
  font-size: 1.375rem;
}
:root[data-theme-id^="olympus"] .chat-markdown h2 {
  font-size: 1.15rem;
}
:root[data-theme-id^="olympus"] .chat-markdown h3 {
  font-size: 1rem;
}
:root[data-theme-id^="olympus"] .chat-markdown th {
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
}
:root[data-theme-id^="olympus"] :is([data-slot="dialog-title"], [data-settings-scroll-target] h2) {
  font-weight: 600;
  letter-spacing: -0.015em;
  text-transform: none;
}
:root[data-theme-id^="olympus"]:not(.dark) :is([data-slot="dialog-title"], [data-settings-scroll-target] h2) {
  font-size: 1.375rem;
  line-height: 1.25;
}

/* Compact section and menu headers: replace cramped 10px uppercase serif with crisp 12px semibold sans. */
:root[data-theme-id^="olympus"] :is(
  [data-thread-details-card] section h3,
  [data-thread-details-card] section.oly-bg .oly-bg-head h3
) {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-transform: none;
  line-height: 1.3;
}
:root[data-theme-id^="olympus"] .oly-plan-menu::before {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-transform: none;
  line-height: 1.3;
}
:root[data-theme-id^="olympus"][lang="en"] .oly-plan-menu::before {
  content: "Response mode";
}
:root[data-theme-id^="olympus"].dark :is(
  .oly-stats h3,
  .oly-stats tr.grp td,
  .oly-mach-head,
  .oly-or-title,
  .oly-studio-pop .h b,
  .oly-studio-dialog > header .oly-studio-title,
  .oly-studio-dialog .studio-state b,
  .oly-tk-navtitle,
  .oly-tk-crumb h2,
  .oly-tk-colhead,
  .oly-tk-mbox h3,
  .oly-tk-lhead,
  .oly-wp-pop h2,
  .oly-mcp-pane h2
) {
  text-transform: none;
  letter-spacing: 0.005em;
  font-weight: 600;
}
:root[data-theme-id^="olympus"].dark .oly-mach-head,
:root[data-theme-id^="olympus"].dark .oly-or-title,
:root[data-theme-id^="olympus"].dark .oly-tk-colhead {
  font-size: 12px;
  line-height: 1.35;
}
:root[data-theme-id^="olympus"].dark .oly-studio-dialog > header .oly-studio-title,
:root[data-theme-id^="olympus"].dark .oly-mcp-pane h2 {
  font-size: 14px;
  line-height: 1.3;
}
:root[data-theme-id^="olympus"].dark .oly-studio-pop .h b,
:root[data-theme-id^="olympus"].dark .oly-studio-dialog .studio-state b,
:root[data-theme-id^="olympus"].dark .oly-tk-lhead {
  font-size: 13.5px;
  line-height: 1.3;
}
:root[data-theme-id^="olympus"].dark .oly-tk-navtitle,
:root[data-theme-id^="olympus"].dark .oly-tk-crumb h2,
:root[data-theme-id^="olympus"].dark .oly-tk-mbox h3,
:root[data-theme-id^="olympus"].dark .oly-wp-pop h2 {
  font-size: 16px;
  line-height: 1.3;
}

/* WCAG AA contrast floor (>= 4.5:1) for muted secondary text across Graphite and classic night Olympus. */
:root[data-theme-id^="olympus"].dark :is(
  .oly-or-id,
  .oly-or-count,
  .oly-or-hint,
  .oly-or-empty,
  .oly-ik-eye,
  .oly-mach-keys,
  .oly-mach-key,
  .oly-tk-colhead small,
  [data-thread-details-card] .oly-td-cap,
  [data-thread-details-card] .oly-td-reset
) {
  color: var(--muted-foreground);
  opacity: 1;
}
`;
