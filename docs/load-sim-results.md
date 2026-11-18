# Load simulation results

Synthetic load from one laptop against the target named in each section. These are simulated taps, not real buyers.


## 2026-11-18T22:31:26.264Z · local dev server, not production

- Target: http://localhost:3100 (local dev server talking to the remote database; latencies are not meaningful for the product)
- Git commit: 942b727
- Shape: 30 buyers, 20 claim taps at uniformly random offsets inside 500 ms on one variant with 2 units, 10 viewers each fetching drop state once. Waitlist cap 200.
- Burst spread achieved: first to last claim send 398 ms (window 500 ms)
- Run time: 17.4 s including setup, warm-up and verification (before cleanup)
- The target must share SESSION_SECRET and the database with the machine running this script (production does); sessions are minted locally, so there are no join calls.
- Latencies are client-observed from one laptop, not from the buyers' network, and include TLS and connection set-up for each simulated buyer.

| Request | n | min ms | median ms | p95 ms | p99 ms | max ms |
|---|---|---|---|---|---|---|
| POST /api/claims (all taps) | 20 | 3261 | 3333 | 3501 | 3643 | 3643 |
| winning taps only | 2 | 3263 | 3263 | 3355 | 3355 | 3355 |
| GET /api/drops/:id/state (viewers) | 10 | 2262 | 2367 | 2900 | 2900 | 2900 |

Server-side `ms` (milliseconds after the item went live, server clock) for the 2 winners: 11476, 11597

Warm-up (separate drop, before the burst): state cold 1343 ms (200); state warm 455 ms (200); claim cold 1150 ms (won); claim warm 1 1340 ms (waitlisted); claim warm 2 573 ms (waitlisted)

Claim results: waitlisted 18, won 2. Rate-limited (429): 0. Errors (5xx, timeouts, network): none.

| Invariant (checked in the database) | Result | Detail |
|---|---|---|
| Zero double sells: held claims on the variant = units | PASS | 2 held / 2 units |
| Winners reported by the API = units | PASS | 2 won responses |
| Stock available = 0, never negative (total 2) | PASS | available 0, total 2 |
| Waitlisted = min(waitlist_max, taps - units), positions 1..n unique and in committed_at order | PASS | 18 waitlisted, expected 18, positions ok |
| No buyer has two active claims on the item | PASS | 0 buyers |
| Orders = units | PASS | 2 orders |
| Every tap got a definite result (no 5xx, no timeouts) | PASS | 20/20 definite, errors {} |
| No rate-limited (429) responses | PASS | 0 responses |

## 2026-11-18T22:32:19.624Z · local dev server, not production

- Target: http://localhost:3100 (local dev server talking to the remote database; latencies are not meaningful for the product)
- Git commit: 942b727
- Shape: 400 buyers, 300 claim taps at uniformly random offsets inside 500 ms on one variant with 2 units, 100 viewers each fetching drop state once. Waitlist cap 200.
- Burst spread achieved: first to last claim send 496 ms (window 500 ms)
- Run time: 45.8 s including setup, warm-up and verification (before cleanup)
- The target must share SESSION_SECRET and the database with the machine running this script (production does); sessions are minted locally, so there are no join calls.
- Latencies are client-observed from one laptop, not from the buyers' network, and include TLS and connection set-up for each simulated buyer.

| Request | n | min ms | median ms | p95 ms | p99 ms | max ms |
|---|---|---|---|---|---|---|
| POST /api/claims (all taps) | 300 | 16180 | 30000 | 30001 | 30002 | 30003 |
| winning taps only | 2 | 16180 | 16180 | 16655 | 16655 | 16655 |
| GET /api/drops/:id/state (viewers) | 100 | 7978 | 25723 | 30001 | 30001 | 30002 |

Server-side `ms` (milliseconds after the item went live, server clock) for the 2 winners: 26591, 26999

Warm-up (separate drop, before the burst): state cold 1398 ms (200); state warm 339 ms (200); claim cold 2373 ms (won); claim warm 1 1290 ms (waitlisted); claim warm 2 795 ms (waitlisted)

Claim results: timeout 270, waitlisted 28, won 2. Rate-limited (429): 0. Errors (5xx, timeouts, network): {"timeout":283}.

| Invariant (checked in the database) | Result | Detail |
|---|---|---|
| Zero double sells: held claims on the variant = units | PASS | 2 held / 2 units |
| Winners reported by the API = units | PASS | 2 won responses |
| Stock available = 0, never negative (total 2) | PASS | available 0, total 2 |
| Waitlisted = min(waitlist_max, taps - units), positions 1..n unique and in committed_at order | FAIL | 34 waitlisted, expected 200, positions MISMATCH |
| No buyer has two active claims on the item | PASS | 0 buyers |
| Orders = units | PASS | 2 orders |
| Every tap got a definite result (no 5xx, no timeouts) | FAIL | 30/300 definite, errors {"timeout":283} |
| No rate-limited (429) responses | PASS | 0 responses |

## 2026-11-18T22:33:31.550Z · local dev server, not production

- Target: http://localhost:3100 (local dev server talking to the remote database; latencies are not meaningful for the product)
- Git commit: 942b727
- Shape: 400 buyers, 300 claim taps at uniformly random offsets inside 500 ms on one variant with 2 units, 100 viewers each fetching drop state once. Waitlist cap 200.
- Burst spread achieved: first to last claim send 495 ms (window 500 ms)
- Run time: 55.7 s including setup, warm-up and verification (before cleanup)
- The target must share SESSION_SECRET and the database with the machine running this script (production does); sessions are minted locally, so there are no join calls.
- Latencies are client-observed from one laptop, not from the buyers' network, and include TLS and connection set-up for each simulated buyer.

| Request | n | min ms | median ms | p95 ms | p99 ms | max ms |
|---|---|---|---|---|---|---|
| POST /api/claims (all taps) | 300 | 11579 | 35206 | 39193 | 39511 | 39790 |
| winning taps only | 2 | 11579 | 11579 | 11723 | 11723 | 11723 |
| GET /api/drops/:id/state (viewers) | 100 | 4456 | 26281 | 31415 | 32036 | 32096 |

Server-side `ms` (milliseconds after the item went live, server clock) for the 2 winners: 17840, 17932

Warm-up (separate drop, before the burst): state cold 687 ms (200); state warm 388 ms (200); claim cold 573 ms (won); claim warm 1 808 ms (waitlisted); claim warm 2 619 ms (waitlisted)

Claim results: waitlist_full 98, waitlisted 200, won 2. Rate-limited (429): 0. Errors (5xx, timeouts, network): none.

| Invariant (checked in the database) | Result | Detail |
|---|---|---|
| Zero double sells: held claims on the variant = units | PASS | 2 held / 2 units |
| Winners reported by the API = units | PASS | 2 won responses |
| Stock available = 0, never negative (total 2) | PASS | available 0, total 2 |
| Waitlisted = min(waitlist_max, taps - units), positions 1..n unique and in committed_at order | PASS | 200 waitlisted, expected 200, positions ok |
| No buyer has two active claims on the item | PASS | 0 buyers |
| Orders = units | PASS | 2 orders |
| Every tap got a definite result (no 5xx, no timeouts) | PASS | 300/300 definite, errors {} |
| No rate-limited (429) responses | PASS | 0 responses |

## 2026-11-18T23:43:43.657Z · deployed target

- Target: https://tapdibs.vercel.app
- Git commit: d520c62
- Shape: 400 buyers, 300 claim taps at uniformly random offsets inside 500 ms on one variant with 2 units, 100 viewers each fetching drop state once. Waitlist cap 200.
- Burst spread achieved: first to last claim send 719 ms (window 500 ms)
- Run time: 17.4 s including setup, warm-up and verification (before cleanup)
- The target must share SESSION_SECRET and the database with the machine running this script (production does); sessions are minted locally, so there are no join calls.
- Latencies are client-observed from one laptop, not from the buyers' network, and include TLS and connection set-up for each simulated buyer.

| Request | n | min ms | median ms | p95 ms | p99 ms | max ms |
|---|---|---|---|---|---|---|
| POST /api/claims (all taps) | 300 | 241 | 1101 | 1425 | 1834 | 1852 |
| winning taps only | 2 | 266 | 266 | 799 | 799 | 799 |
| GET /api/drops/:id/state (viewers) | 100 | 600 | 1131 | 1420 | 1808 | 1836 |

Server-side `ms` (milliseconds after the item went live, server clock) for the 2 winners: 5475, 5515

Warm-up (separate drop, before the burst): state cold 1297 ms (200); state warm 170 ms (200); claim cold 365 ms (won); claim warm 1 136 ms (waitlisted); claim warm 2 139 ms (waitlisted)

Claim results: http_500 185, waitlisted 113, won 2. Rate-limited (429): 0. Errors (5xx, timeouts, network): {"HTTP 500":248}.

| Invariant (checked in the database) | Result | Detail |
|---|---|---|
| Zero double sells: held claims on the variant = units | PASS | 2 held / 2 units |
| Winners reported by the API = units | PASS | 2 won responses |
| Stock available = 0, never negative (total 2) | PASS | available 0, total 2 |
| Waitlisted = min(waitlist_max, taps - units), positions 1..n unique and in committed_at order | FAIL | 113 waitlisted, expected 200, positions ok |
| No buyer has two active claims on the item | PASS | 0 buyers |
| Orders = units | PASS | 2 orders |
| Every tap got a definite result (no 5xx, no timeouts) | FAIL | 115/300 definite, errors {"HTTP 500":248} |
| No rate-limited (429) responses | PASS | 0 responses |

## 2026-11-18T23:46:01.175Z · deployed target

- Target: https://tapdibs.vercel.app
- Git commit: f5f52cc
- Shape: 400 buyers, 300 claim taps at uniformly random offsets inside 500 ms on one variant with 2 units, 100 viewers each fetching drop state once. Waitlist cap 200.
- Burst spread achieved: first to last claim send 532 ms (window 500 ms)
- Run time: 30.7 s including setup, warm-up and verification (before cleanup)
- The target must share SESSION_SECRET and the database with the machine running this script (production does); sessions are minted locally, so there are no join calls.
- Latencies are client-observed from one laptop, not from the buyers' network, and include TLS and connection set-up for each simulated buyer.

| Request | n | min ms | median ms | p95 ms | p99 ms | max ms |
|---|---|---|---|---|---|---|
| POST /api/claims (all taps) | 300 | 2994 | 3950 | 4487 | 4691 | 4760 |
| GET /api/drops/:id/state (viewers) | 100 | 3056 | 3963 | 4634 | 4826 | 4870 |

Server-side `ms` (milliseconds after the item went live, server clock) for the 0 winners: -

Warm-up (separate drop, before the burst): state cold 531 ms (500); state warm 3671 ms (500); claim cold 3090 ms (http_500); claim warm 1 3338 ms (http_500); claim warm 2 3049 ms (http_500)

Claim results: http_500 300. Rate-limited (429): 0. Errors (5xx, timeouts, network): {"HTTP 500":400}.

| Invariant (checked in the database) | Result | Detail |
|---|---|---|
| Zero double sells: held claims on the variant = units | FAIL | 0 held / 2 units |
| Winners reported by the API = units | FAIL | 0 won responses |
| Stock available = 0, never negative (total 2) | FAIL | available 2, total 2 |
| Waitlisted = min(waitlist_max, taps - units), positions 1..n unique and in committed_at order | FAIL | 0 waitlisted, expected 200, positions ok |
| No buyer has two active claims on the item | PASS | 0 buyers |
| Orders = units | FAIL | 0 orders |
| Every tap got a definite result (no 5xx, no timeouts) | FAIL | 0/300 definite, errors {"HTTP 500":400} |
| No rate-limited (429) responses | PASS | 0 responses |
