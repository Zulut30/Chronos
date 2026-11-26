cd apps/server
vp test run src/provider/acp/AntigravityTurnOutcome.test.ts src/orchestration-v2/UsageLimitRecoveryWorker.test.ts
vp test run src/mcp/OrchestratorMcpToolkit.integration.test.ts -t 'reports distinct child results'
vp test run src/scheduledTasks/ScheduledTaskService.schedule.test.ts
vp test run src/peer/RemoteDelegation.test.ts -t 'a task naming another driver there'
vp test run src/terminal/Manager.test.ts -t 'opens the available Windows shell'
vp test run src/mcp/OrchestratorMcpService.test.ts -t 'inherits delegated options|prepares a worktree in the selected project'
