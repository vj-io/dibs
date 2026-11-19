-- Disk IO: these five tables hold throwaway rows (rate-limit hits, AI throttles, webhook replay guards, the demo
-- bot script). Each row is written and deleted within minutes, and their write-ahead log was a large share of the
-- database's disk writes (measured 19 Nov 2026 after the test runs). UNLOGGED skips the log for them.
-- Cost: after a database crash they start empty. That means a fresh rate-limit window, a webhook delivered twice
-- inside its replay window being processed twice (the engine calls are safe to repeat), and running demo rooms
-- losing their remaining bot script. Stock, claims, orders, outbox and audit stay fully logged.
alter table rate_hits set unlogged;
alter table throttles set unlogged;
alter table webhook_nonces set unlogged;
alter table webhook_seen set unlogged;
alter table bot_schedule set unlogged;
