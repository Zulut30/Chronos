cd apps/server
vp test run src/chronos/claudeProcessGuard.test.ts src/orchestration-v2/ProviderSessionManager.test.ts
vp test run src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts -t 'resumes the native session on a fresh session instance|resumes an imported native session|resumes the session a /clear selected'
