cd apps/server
vp test run src/orchestration-v2/ProviderSessionTransitionPolicy.test.ts
vp test run src/orchestration-v2/Adapters/CodexAdapterV2.test.ts -t 'derives concrete Codex turn policies|full access asks about|Codex file-change approval paths|handles MCP access approvals'
vp test run src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts -t 'maps default full-access policy|keeps approval-required mode interactive|marks asks that full access|adds nothing to ordinary approvals|asks before restricted Full access'
vp test run src/orchestration-v2/Adapters/OpenCode2AdapterV2.test.ts src/orchestration-v2/Adapters/AcpRegistryAdapterV2.test.ts src/orchestration-v2/Adapters/KiroAdapterV2.test.ts src/orchestration-v2/Adapters/GrokAdapterV2.test.ts src/orchestration-v2/Adapters/FxAdapterV2.test.ts -t 'permission|approval|runtime mode|autopilot|[Ff]ull access'
(cd ../../packages/provider-acp && vp test run src/server/clientPolicy.test.ts)
(cd ../../packages/provider-opencode && vp test run src/server/adapter.test.ts -t 'maps runtime modes|enforces non-interactive|identified local tool')
(cd ../../packages/provider-muse && vp test run src/server/adapter.test.ts src/server/sdk.test.ts src/server/protocol.test.ts)
(cd ../../packages/provider-pi && vp test run src/server/mcpExtensionSource.test.ts)
(cd ../../packages/provider-cursor && vp test run src/server/adapter.test.ts -t 'maps runtime modes to the SDK sandbox')
