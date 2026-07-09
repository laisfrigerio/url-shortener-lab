# URL Shortener Performance Lab

This repository is a hands-on lab to measure and improve URL shortener performance using:

- Database indexing (PostgreSQL)
- Connection pooling (Node.js + `pg`)
- External cache (Redis)

Load tests are executed with `k6` against the redirect endpoint.

## 🖥️ Test environment infrastructure

Host (MacBook Pro):

| Spec      |          Value          |
|-----------|-------------------------|
| Chip      |  Apple M3 Pro           |
| Cores     |  11                     |
| RAM       |  18 GB                  |
| OS        |  macOS 26.5.1 (Sequoia) |

**Docker containers with explicit resource limits**, simulating a constrained environment (similar to a small cloud instance):

| Container       | CPU limit | Memory limit | Rationale                                         |
|-----------------|-----------|--------------|---------------------------------------------------|
| `shortener-db`  | 0.50 vCPU | 256 MB       | Buffer cache for index + data pages               |
| `shortener-app` | 0.25 vCPU | 128 MB       | I/O-bound Node.js, peak estimated at ~80 MB       |
| `shortener-redis`| 0.10 vCPU | 64 MB        | Hot keys only, in-memory ops                      |
| **Total**       | **0.85 vCPU** | **448 MB** |                                                |

> The total available memory from Docker Desktop's Linux VM was 7.75 GiB.
> Limits were deliberately set to simulate a realistic small production environment (e.g. AWS `t3.small`).

## Results

### Phase 1

> **Setup:** No index · No connection pooling · No cache

| Metrics   |    Value    |
|-----------|-------------|
| min       | 5.39s       |
| avg       | 21.24s      |
| med       | 21.99s      |
| max       | 23.09s      |
| p(90)     | 22.88s      |
| p(95)     | 22.99s      |
| req/s     | 2.2         |
| http fail | ✅ 0%       |
| status ok | ✅ 100%     |
| <200ms    | ❌ 0%       |

> **Note:** With CPU limited to 0.5 vCPU, the PostgreSQL Sequential Scan over 1 million records became catastrophic.
> Average latency reached **21 seconds**, and throughput collapsed to only **2.2 req/s**.
> The bottleneck is the full table scan under constrained CPU — each query forces the engine to read every row before finding the match at the end of the table.

---

### Phase 2

> **Setup:** With index · No connection pooling · No cache

| Metrics   |  Phase 1 |  Phase 2  | Improve |
|-----------|----------|-----------|---------|
| min       | 5.39s    | 397.22ms  | -93%    |
| avg       | 21.24s   | 3.15s     | -85%    |
| med       | 21.99s   | 3.1s      | -86%    |
| max       | 23.09s   | 4.69s     | -80%    |
| p(90)     | 22.88s   | 3.78s     | -83%    |
| p(95)     | 22.99s   | 3.9s      | -83%    |
| req/s     | 2.2      | 15        | +582%   |
| http fail | ✅ 0%    | ✅ 0%     | -       |
| status ok | ✅ 100%  | ✅ 100%   | -       |
| <200ms    | ❌ 0%    | ❌ 0%     | -       |

> **Note:** The index reduced average latency from 21s to 3.1s (**85% improvement**) and multiplied throughput by nearly **7x** (2.2 → 15 req/s).
> However, p95 is still at 3.9s — the reconnection overhead (opening and closing a TCP connection per request, without pooling) is now the dominant bottleneck.
> Under constrained CPU, establishing a new connection per request is expensive enough to keep latency in the seconds range.

---

### Phase 3

> **Setup:** With index · With connection pooling · No cache

| Metrics   |  Phase 1 |  Phase 2  |  Phase 3    | Improve vs F2 |
|-----------|----------|-----------|-------------|---------------|
| min       | 5.39s    | 397.22ms  | 413µs       | -99%          |
| avg       | 21.24s   | 3.15s     | 221.64ms    | -93%          |
| med       | 21.99s   | 3.1s      | 200.89ms    | -94%          |
| max       | 23.09s   | 4.69s     | 818.29ms    | -83%          |
| p(90)     | 22.88s   | 3.78s     | 392.58ms    | -90%          |
| p(95)     | 22.99s   | 3.9s      | 481.06ms    | -88%          |
| req/s     | 2.2      | 15        | 154         | +927%         |
| http fail | ✅ 0%    | ✅ 0%     | ✅ 0%        | -             |
| status ok | ✅ 100%  | ✅ 100%   | ✅ 100%      | -             |
| <200ms    | ❌ 0%    | ❌ 0%     | ❌ 48%       | -             |

> **Note:** Connection pooling had a massive impact under constrained resources.
> Average latency dropped from 3.15s → 221ms (**93% improvement**), and throughput jumped from 15 → 154 req/s (**10x increase**).
> The pool reuses established TCP connections, eliminating the reconnection cost that dominated Phase 2.
> With limited CPU, this overhead was amplified — making the pooling gain even more visible than in an unconstrained environment.
> p95 at 481ms indicates the pool (default size: 10 connections) causes queuing under 50 concurrent VUs.

---

### Phase 4

> **Setup:** With index · With connection pooling · With Redis cache

| Metrics   |  Phase 1 |  Phase 2  |  Phase 3    |  Phase 4    |
|-----------|----------|-----------|-------------|-------------|
| min       | 5.39s    | 397.22ms  | 413µs       | 3.4ms       |
| avg       | 21.24s   | 3.15s     | 221.64ms    | 215.61ms    |
| med       | 21.99s   | 3.1s      | 200.89ms    | 187.56ms    |
| max       | 23.09s   | 4.69s     | 818.29ms    | 1.27s       |
| p(90)     | 22.88s   | 3.78s     | 392.58ms    | 406.16ms    |
| p(95)     | 22.99s   | 3.9s      | 481.06ms    | 588ms       |
| req/s     | 2.2      | 15        | 154         | 157         |
| http fail | ✅ 0%    | ✅ 0%     | ✅ 0%        | ✅ 0%       |
| status ok | ✅ 100%  | ✅ 100%   | ✅ 100%      | ✅ 100%     |
| <200ms    | ❌ 0%    | ❌ 0%     | ❌ 48%       | ❌ 62%      |

> **Note:** Redis cache provided negligible improvement over Phase 3 in aggregate metrics (avg: 221ms → 215ms, req/s: 154 → 157).
> More notably, the **p95 worsened** from 481ms to 588ms (+22%), which is a counter-intuitive result. Cache hits should make things faster, not slower.
>
> Two hypotheses were raised and subsequently validated with targeted experiments:
>
> **Hypothesis 1 — Pool contention masking the cache benefit (validated ✅)**
>
> With 50 concurrent VUs and a pool of 10 connections, most requests queue for a connection. The Redis lookup happens before the DB query, but the queuing bottleneck remains unchanged — so the cache removes the DB round-trip but doesn't address the real wait time.
>
> Validation: re-ran Phase 3 and Phase 4 with **10 VUs** (below pool size threshold) and `cpus: '0.25'`:
>
> | Metrics | Phase 3 (10 VUs) | Phase 4 (10 VUs) | Improve |
> |---------|------------------|------------------|---------|
> | avg     | 27.21ms          | 9.9ms            | -64% ✅ |
> | med     | 6.61ms           | 5.63ms           | -15% ✅ |
> | p(90)   | 48.67ms          | 10.49ms          | -78% ✅ |
> | p(95)   | 93.51ms          | 14.04ms          | -85% ✅ |
> | req/s   | 78               | 90               | +15% ✅ |
>
> With pool contention removed, Redis delivered a clear **85% p95 improvement**. The cache benefit was real all along — it was hidden by queuing.
>
> **Hypothesis 2 — CPU pressure adding overhead to the Redis extra hop (partially validated ⚠️)**
>
> Under `cpus: '0.25'`, even a sub-millisecond Redis GET adds measurable overhead under high concurrency. Validation: re-ran Phase 3 and Phase 4 with **50 VUs** and `cpus: '1.0'` for the app. `docker stats` captured during the test showed `shortener-app` at **15.76% CPU** (well below the 100% limit), confirming the app was **not CPU-saturated** even at 0.25 vCPU:
>
> | Metrics | Phase 3 (50 VUs, 1 vCPU) | Phase 4 (50 VUs, 1 vCPU) | Improve |
> |---------|--------------------------|--------------------------|---------|
> | avg     | 5.3ms                    | 5.05ms                   | -5%     |
> | med     | 4.47ms                   | 4.65ms                   | ≈       |
> | p(90)   | 8.05ms                   | 7.84ms                   | -3%     |
> | p(95)   | 9.56ms                   | 9ms                      | -6%     |
> | req/s   | 474                      | 475                      | ≈       |
>
> With more CPU, the results of Phase 3 and Phase 4 became virtually identical — mirroring the unconstrained Mac host results. This **refutes** the CPU hypothesis: the app was never CPU-bound. The pool contention was the sole cause of the poor Phase 4 result at 50 VUs.
>
> **Conclusion:** Redis cache is effective, but only when requests are not already bottlenecked by pool queuing. At 50 VUs with a pool of 10 connections, eliminating the cache miss doesn't help because requests are waiting for a connection slot, not for the database query itself. Scaling the pool size (e.g. `max: 50`) or reducing VUs below the pool limit exposes the true cache benefit.

---

## 🔑 Key Observations

### 1. Bottlenecks are sequential: fixing one reveals the next

Each phase exposed a different dominant constraint:

| Phase | Dominant bottleneck | Fix applied |
|-------|---------------------|-------------|
| 1     | Sequential Scan (Full Table Scan) | Add index |
| 2     | TCP reconnection per request | Enable connection pooling |
| 3     | Pool queue contention (10 connections, 50 VUs) | Add cache / scale pool |
| 4     | Cache benefit hidden by pool queue | Reduce concurrency or increase pool size |

You cannot skip steps. Applying the index without pooling still leaves p95 at 3.9s. Applying cache without addressing pool contention yields no observable gain.

### 2. Resource constraints amplify every bottleneck

The same workload that produced a p95 of **647ms** on the unconstrained Mac host produced **22.99s** under 0.50 vCPU for the database. A Sequential Scan is expensive in any environment, but under constrained CPU it becomes catastrophic, collapsing throughput from 118 req/s to **2.2 req/s**.

This makes resource-limited testing valuable for exposing bottlenecks that would be invisible on a developer's local machine.

### 3. Aggregate metrics can be misleading

In Phase 1 (with redirect follow enabled), 42% of requests failed with HTTP 500, dragging the overall average down to 225ms, falsely suggesting good performance. Filtering to `expected_response:true` revealed the true avg of **380ms** for successful requests only.

Similarly, in Phase 4 at 50 VUs, aggregate metrics showed marginal improvement from Redis. Only by isolating variables (10 VUs to remove pool contention) did the **85% p95 improvement** from the cache become visible.

**Lesson:** always filter metrics by success status, and isolate variables before drawing conclusions.

### 4. The app was never the bottleneck

`docker stats` during the Phase 4 test at peak load showed `shortener-app` consuming only **15.76% of its CPU limit** (0.25 vCPU). Node.js, being I/O-bound, spends most of its time waiting for responses from Postgres or Redis, not computing. Increasing the app's CPU to 1.0 vCPU had no meaningful effect on latency.

The real constraint was always the **database** (query strategy) and the **connection management** (pooling + pool size relative to concurrency).

### 5. Redis is a layer-3 optimization, not a layer-1 fix

Redis delivered clear gains only after the foundational problems (index, pooling) were addressed. Adding cache on top of a Sequential Scan or without pooling would not have helpe. The database round-trip was not the dominant cost in those scenarios.

The order of operations matters: **index → pooling → cache**, each targeting a different layer of the stack.
