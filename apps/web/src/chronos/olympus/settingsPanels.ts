export const settingsPanels = [
  {
    id: "olympus-api-keys",
    title: "API-ключи",
    english: "API keys",
    selector: "[data-oly-ik-nav] button",
  },
  {
    id: "olympus-mcp",
    title: "Серверы MCP",
    english: "MCP servers",
    selector: "[data-oly-mcp-nav] button",
  },
  {
    id: "olympus-prompts",
    title: "Шаблоны промптов",
    english: "Prompt templates",
    selector: "[data-oly-ps-nav-button]",
  },
] as const;

export const panelSearchItems = settingsPanels.map(({ id, title, english }) => ({
  id,
  title: english,
  searchTerms: [title],
  to: "/settings/providers" as const,
}));
