// Imported first by every sandbox test: mock transport (in-process bus), no AI key (no model quota used), a bigger pool.
// Run: node --env-file=.env.local --test --test-concurrency=1 "tests/sandbox/*.test.ts"
process.env.REALTIME_MODE = "mock";
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "";
process.env.DB_POOL_MAX ??= "24";
