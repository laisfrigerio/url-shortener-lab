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

**Available limits for Docker: up to 7.75 GiB.**

> Docker Desktop on macOS runs in a Linux VM. The 7.75 GiB is the limit allocated to that VM (not the host total). Containers compete with each other within that pool.

## Results

### Phase 1

| Metrics   |    1m    |
|-----------|----------|
| min       | 59.47ms  |
| avg       | 321.77ms |
| med       | 266.84ms |
| max       | 1.06s    |
| p(90)     | 579.48ms |
| p(95)     | 646.58ms |
| req/s     | 118      |
| http fail | 0%       |
| status ok | ✅ 100%  |
| <200ms    | ❌ 30%   |

> **Note:** Sequential Scan is possible the bottleneck: a p95 of 647ms to find 1 row out of 1 million.

### Phase 2

| Metrics   |  Phase 1 |  Phase 2  | Improve |
|-----------|----------|-----------|---------|
| min       | 59.47ms  | 4.28ms    | -93%  | 
| avg       | 321.77ms | 46.08ms   | -86%  |
| med       | 266.84ms | 41.63ms   | -84%  |
| max       | 1.06s    | 210ms     | -80%  |
| p(90)     | 579.48ms | 66.5ms    | -89%  |
| p(95)     | 646.58ms | 75.92ms   | -88%  |
| req/s     | 118      | 341       | +189% |
| http fail | 0%       | 0%        | -     |
| status ok | ✅ 100%  | ✅ 100%    | -     |
| <200ms    | ❌ 30%   | 99.7%     | -     |

> **Note**: Almost 100% of the requests responded in under 200ms. \
\
  *The metric reduced the p95 from 647ms to 76ms (an 88% drop). \
  *Throughput jumped from 118 to 341 req/s (almost 3x higher). \
  *99.7% of requests respond in under 200ms — only 44 out of 20k exceeded this.

**This proves how a simple adjustment can solve a large part of the problem. The Sequential Scan was indeed the dominant bottleneck of Phase 1. With the index, Postgres goes directly to the record and responds in ~4ms.**

### Phase 3

| Metrics   |  Phase 1 |  Phase 2  |  Phase 3  | Improve vs F2 |
|-----------|----------|-----------|-----------|---------|
| min       | 59.47ms  | 4.28ms    | 380µs   | -91%  | 
| avg       | 321.77ms | 46.08ms   | 5.14ms  | -89%  |
| med       | 266.84ms | 41.63ms   | 4.5ms   | -89%  |
| max       | 1.06s    | 210ms     | 105ms   | -50%  |
| p(90)     | 579.48ms | 66.5ms    | 8.26ms  | -88%  |
| p(95)     | 646.58ms | 75.92ms   | 10.29ms | -86%  |
| req/s     | 118      | 341       | 474     | +39%  |
| http fail | 0%       | 0%        | 0%      | -     |
| status ok | ✅ 100%  | ✅ 100%   | ✅ 100%  | -     |
| <200ms    | ❌ 30%   | 99.7%     | 100% ✅  | -     |

> **Note**: Pooling eliminated reconnection overhead. With the pool reusing connections: \
\
  *The median dropped from 42ms → 4.5ms (89% drop) \
  *The p95 dropped from 76ms to 10ms (an 86% drop) \
  *100% of requests under 200ms

### Phase 4

| Metrics   |  Phase 1  | Phase 2   | Phase 3    |   Phase 4  |
|-----------|-----------|-----------|------------|------------|
| min       | 59.47ms   | 4.28ms    | 380µs      |            |  
| avg       | 321.77ms  | 46.08ms   | 5.14ms     | 4.78ms     | 
| med       | 266.84ms  | 41.63ms   | 4.5ms      | 4.44ms     | 
| max       | 1.06s     | 210ms     | 105ms      | 20.81ms    | 
| p(90)     | 579.48ms  | 66.5ms    | 8.26ms     | 7.41ms     | 
| p(95)     | 646.58ms  | 75.92ms   | 10.29ms    | 8.99ms     | 
| req/s     | 118       | 341       | 474        | 476        |
| fail req  | ✅ 0%     | ✅ 0%      | ✅ 0%      | ✅ 0%      | 
| status ok | 100%      | 100%      | 100%       | 100%       |
| <200ms    | ❌ 30%    | 99.7%     | 100% ✅     | 100% ✅    |

> **The result for Phase 3 was virtually identical to that of Phase 4 with caching**. Hypothesis: the `sleep(0.1)` between iterations for each VU allows time for the pool to reuse connections, minimizing contention. \
\
  *If this applied to the real world, caching with Redis would be over-engineering at this moment. \
  *Perhaps a test with a higher volume of requests and database records could lead to a scenario where an external cache is a suitable solution.