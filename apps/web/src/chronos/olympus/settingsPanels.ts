export const settingsPanels = [
  { id: "olympus-api-keys", title: "API-ключи", selector: "[data-oly-ik-nav] button" },
  { id: "olympus-mcp", title: "Серверы MCP", selector: "[data-oly-mcp-nav] button" },
  { id: "olympus-prompts", title: "Шаблоны промптов", selector: "[data-oly-ps-nav-button]" },
] as const;

export const panelSearchItems = settingsPanels.map(({ id, title }) => ({
  id, title, to: "/settings/providers" as const,
}));
