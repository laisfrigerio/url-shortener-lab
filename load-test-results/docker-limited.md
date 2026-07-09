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
> Two hypotheses, not yet validated:
>
> 1. **Extra network hop cost under CPU pressure:** Even though Redis responds in <1ms, adding an extra call (GET to Redis before every request) introduces overhead. Under constrained CPU (0.25 vCPU for the app), this additional operation may accumulate latency in high-concurrency scenarios, inflating the tail (p95) instead of reducing it.
>
> 2. **Pool contention masking the cache benefit:** With 50 concurrent VUs and a pool of 10 connections, most requests already queue for a connection in Phase 3. The Redis lookup happens before the DB query, but the queuing bottleneck remains unchanged. So the cache removes the DB round-trip but doesn't address the real wait time.
>
> **What would be needed to confirm:** Run `docker stats` during the test to check if `shortener-app` is saturating its CPU limit; repeat Phase 4 with `cpus: '1.0'` for the app; reduce VUs to 10 to lower pool contention and observe whether Redis then produces a clear improvement.
