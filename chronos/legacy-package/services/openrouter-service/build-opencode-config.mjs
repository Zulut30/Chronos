// Builds opencode-config-content.json for the T3 "OpenRouter" provider instance (OpenCode driver):
// only the OpenRouter provider, every OpenRouter chat model (models.dev catalog + models missing there),
// and this folder's MCP server. No secrets: OpenCode reads OPENROUTER_API_KEY from the environment.
// Usage: node build-opencode-config.mjs   (re-run when OpenRouter adds models, then paste into the instance env)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath.replace(/\\/g, '/');
const SERVER = path.join(HERE, 'server.mjs').replace(/\\/g, '/');

const or = (await (await fetch('https://openrouter.ai/api/v1/models')).json()).data;
const dev = await (await fetch('https://models.dev/api.json')).json();
const known = new Set(Object.keys(dev.openrouter?.models || {}));
const chat = or.filter((m) => (m.architecture?.output_modalities || []).includes('text') && (m.endpoints || ['/chat']).some((e) => e.includes('/chat')));
const extra = {};
for (const m of chat) {
  if (known.has(m.id)) continue;
  const tools = (m.supported_parameters || []).includes('tools');
  const reasoning = (m.supported_parameters || []).includes('reasoning');
  const input = (m.architecture?.input_modalities || ['text']).filter((x) => ['text', 'image', 'pdf', 'audio', 'video'].includes(x));
  extra[m.id] = {
    name: m.name.replace(/^[^:]+:\s*/, ''),
    tool_call: tools, reasoning, attachment: input.some((x) => x !== 'text'),
    modalities: { input, output: ['text'] },
    limit: { context: m.context_length || 128000, output: m.top_provider?.max_completion_tokens || 16384 },
  };
}
const cfg = {
  enabled_providers: ['openrouter'],
  provider: { openrouter: { models: extra } },
  mcp: { openrouter: { type: 'local', command: [NODE, SERVER], enabled: true } },
};
const out = JSON.stringify(cfg);
fs.writeFileSync(path.join(HERE, 'opencode-config-content.json'), out + '\n');
// Ready-to-merge fragment for %USERPROFILE%\.t3\userdata\settings.json (no secrets; key comes from the user env var).
const instance = { providerInstances: { openrouter: {
  driver: 'opencode', displayName: 'OpenRouter', accentColor: '#6467F2', enabled: true,
  environment: [{ name: 'OPENCODE_CONFIG_CONTENT', value: out, sensitive: false }],
  config: { enabled: true },
} } };
fs.writeFileSync(path.join(HERE, 'provider-instance.json'), JSON.stringify(instance, null, 2) + '\n');
console.log(`OpenRouter chat models: ${chat.length}; in models.dev: ${chat.length - Object.keys(extra).length}; added: ${Object.keys(extra).length}; size ${out.length} chars`);
