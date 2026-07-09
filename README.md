# URL Shortener Performance Lab

This repository is a hands-on lab to measure and improve URL shortener performance using:

- Database indexing (PostgreSQL)
- Connection pooling (Node.js + `pg`)
- External cache (Redis)

Load tests are executed with `k6` against the redirect endpoint.

## Goal

Reproduce a bottleneck scenario first, then apply optimizations in phases and compare metrics (`http_req_duration`, `p95`, checks, and throughput).

## Stack

- Node.js (`express`, `pg`, `redis`)
- PostgreSQL 15
- Redis 7
- Docker Compose
- k6

## Project Structure

```txt
.
├── backend/
│   ├── src/
│   │   ├── server.js
│   │   └── index.html
│   ├── package.json
│   └── Dockerfile
├── db/
│   └── init.sql
├── k6/
│   └── load-test.js
└── docker-compose.yml
```

## Data Seed

On first PostgreSQL startup, `db/init.sql` is executed automatically via `/docker-entrypoint-initdb.d/`.

It creates table `urls` and inserts:

- 150,000 random rows (to encourage sequential scan behavior without index)
- 1 known record at the end: `nu9999 -> https://nubank.com.br`

This key is the target used in load tests.

## Main HTML Page

A simple page is served by the backend to manually submit long URLs.

<p align="center">
  <a><img src="./screenshots/main-page.png" alt="Main HTML page" title="Main HTML page"></a>
</p>

## Prerequisites

- Docker + Docker Compose
- k6 installed locally

macOS (Homebrew):

```sh
brew install k6
```

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

## Run the Lab

### 1) Baseline: No index, no pooling, no cache

Default app flags in `docker-compose.yml`:

- `ENABLE_POOLING=false`
- `ENABLE_CACHE=false`

Start everything:

```sh
docker-compose up --build -d
```

Optional seed verification:

```sh
docker exec -it shortener-db psql -U user_admin -d shortener_db -c "SELECT COUNT(*) FROM urls;"
```

Run load test:

```sh
k6 run k6/load-test.js
```

### 2) Add database index

Create index on lookup column:

```sh
docker exec -it shortener-db psql -U user_admin -d shortener_db -c "CREATE INDEX idx_urls_short_url ON urls(short_url);"
```

Run the same test again:

```sh
k6 run k6/load-test.js
```

### 3) Enable connection pooling

Set in `docker-compose.yml`:

- `ENABLE_POOLING=true`

Restart app container:

```sh
docker-compose up -d app
```

Run the test again:

```sh
k6 run k6/load-test.js
```

### 4) Enable Redis cache

Set in `docker-compose.yml`:

- `ENABLE_CACHE=true`

Restart app container:

```sh
docker-compose up -d app
```

Run the test again:

```sh
k6 run k6/load-test.js
```

## k6 Scenario

`k6/load-test.js` runs:

- `50` virtual users
- `30s` duration
- requests to `GET http://localhost:3000/nu9999`

Checks:

- status is `200` or `302`
- response time under `200ms`

## Load Test results

- [MacOS as host](./load-test-results/mac-host.md)

## Author

| [<img src="https://avatars.githubusercontent.com/u/20709086?v=4" width="100px;" alt="Lais Frigério"/><br /><sub><b>@laisfrigerio</b></sub>](https://github.com/laisfrigerio)<br /> |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |

## License

This project is licensed under the MIT License. See `LICENSE` for details.
