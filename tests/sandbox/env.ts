// Imported first by every sandbox test: mock transport (in-process bus), no AI key (no model quota used), a bigger pool.
// Engine calls go the way production sends them (HTTP RPC).
// Run: npm run test:sandbox
process.env.REALTIME_MODE = "mock";
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "";
process.env.DB_POOL_MAX ??= "24";
