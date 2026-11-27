cd apps/server
vp test run src/provider/ProviderInstanceRegistry.test.ts -t 'Claude.*(get_usage|usage|quota|fallback|claim)'
vp test run src/provider/claudeResetCredits.test.ts src/provider/claudeUsageLimits.test.ts
(cd ../../packages/provider-core && vp test run src/server/usageLimits.test.ts)
vp test run src/chronos/claudeProcessGuard.test.ts src/orchestration-v2/ProviderSessionManager.test.ts
vp test run src/orchestration-v2/Adapters/AcpAdapterV2.test.ts -t 'loads the persisted ACP session during startup'
vp test run src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts -t 'resumes the native session on a fresh session instance|resumes an imported native session|resumes the session a /clear selected'
