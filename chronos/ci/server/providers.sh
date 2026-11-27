cd apps/server
vp test run src/provider/acp/AntigravityChildWork.test.ts src/provider/acp/AntigravityProtocol.test.ts src/provider/AntigravityProvider.test.ts src/usage/UsageService.test.ts src/usage/usagePricing.test.ts
(cd ../../packages/provider-core && vp test run src/server/usageLimits.test.ts src/server/managedProvider.test.ts -t 'resolveUsageLimitsAfterProbe|keeps sparse usage')
