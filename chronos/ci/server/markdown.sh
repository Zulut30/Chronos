cd apps/server
vp test run src/guest/guestAttachments.test.ts src/orchestration-v2/ThreadFind.test.ts
vp test run src/orchestration-v2/Adapters/CodexAdapterV2.test.ts -t 'projects generated images'
