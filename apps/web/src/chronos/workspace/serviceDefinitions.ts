export const LOCAL_SERVICES = {
  tasks: { port: 4518, health: "/api/health", label: "Задачи" },
  skills: { port: 4517, health: "/api/health", label: "Скиллы" },
  files: { port: 4519, health: "/health", label: "Загрузки" },
  studio: { port: 4520, health: "/api/health", label: "Студия" },
  integrations: { port: 4522, health: "/api/health", label: "API-ключи" },
  mcp: { port: 4523, health: "/api/health", label: "Серверы MCP" },
} as const;
