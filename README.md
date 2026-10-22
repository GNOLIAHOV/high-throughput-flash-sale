# High-Throughput Flash Sale Engine 

A distributed, high-concurrency ticket booking and flash sale backend built with **NestJS**, **Redis**, **PostgreSQL**, and **BullMQ**.

---

##  Problem Solved
- **Race Conditions & Overselling:** Prevents stock overselling during sudden traffic spikes via atomic operations.
- **Database Bottleneck Offloading:** Decouples order ingestion from persistent storage using message queues.
- **Anti-Bot & Abuse Protection:** Implements distributed sliding-window rate limiting backed by Redis.

---

##  Tech Stack & Architecture
- **Framework:** NestJS (TypeScript)
- **Database & ORM:** PostgreSQL 16 + Prisma ORM
- **Cache & Concurrency:** Redis (ioredis) using atomic **Lua scripts** for stock deduction
- **Message Queue:** BullMQ (Worker pattern for asynchronous database synchronization)
- **Rate Limiting:** `@nestjs/throttler` with Redis storage
- **Containerization:** Docker & Docker Compose (Multi-stage build)

---

##  Performance Benchmark (via Autocannon)
- **Throughput:** ~5,830+ Requests/sec
- **Concurrent Connections:** 50
- **Average Latency:** 8.06 ms
- **Consistency:** 0 oversold items across 29,000+ requests in a 5-second burst test.

---

##  Getting Started

### Prerequisites
- Docker & Docker Compose

### Run the entire stack
```bash
docker compose up -d --build