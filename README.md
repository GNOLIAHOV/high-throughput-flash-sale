# High-Throughput Flash Sale Engine (flashdeal-core)

A distributed, production-grade backend engine designed to handle high-concurrency ticket booking and flash sale events with absolute inventory consistency and sub-10ms response times.

---

## 1. Problem Statement and Key Challenges

During high-profile flash sales or ticket release events, backend systems face three critical failure points:

1. **Race Conditions and Overselling:** Thousands of concurrent requests attempting to purchase limited stock simultaneously, often leading to negative inventory balances under traditional relational transactions.
2. **Database Bottlenecks and Connection Pool Exhaustion:** Direct read/write traffic hammering persistent storage (PostgreSQL/MySQL), causing cascading timeouts and server crashes.
3. **Bot Traffic and Malicious Spikes:** Distributed Denial of Service (DDoS) or automated scalper bots depleting stock within milliseconds.

---

## 2. Architecture and Core Engineering Solutions

```text
[ Client Traffic ]
        |
        v
[ NestJS API Gateway ] --- (Sliding-Window Throttler) ---> [ Redis Guard ] (429 Rate Limit)
        |
        v
[ Atomic Stock Check & Decrement ] --- (Single-trip Lua Script) ---> [ Redis In-Memory Store ]
        |
        v (Stock successfully deducted)
[ Async Order Offloading ] ---> [ BullMQ / Redis Job Queue ]
                                       |
                                       v (Background Worker)
                         [ Persistence & Sync ] ---> [ PostgreSQL 16 (Prisma ORM) ]
```

### Atomic Concurrency Control (Redis + Lua Scripting)
Instead of utilizing database-level pessimistic or optimistic locks (which introduce severe latency and lock contention), inventory is decoupled into Redis RAM.
- Stock deduction is executed inside an atomic Redis Lua script.
- Redis guarantees single-threaded, isolated execution, completely eliminating race conditions and ensuring zero overselling at scale.

### Eventual Consistency via Message Queues (BullMQ)
- The API confirms the purchase once the Redis stock is decremented and immediately enqueues the order payload to a BullMQ queue.
- Background consumer workers asynchronously persist order details into PostgreSQL in batches, keeping the HTTP lifecycle unblocked and sub-10ms.

### Distributed Rate Limiting
- Integrated `@nestjs/throttler` backed by distributed Redis storage.
- Restricts burst requests per IP / client (`/orders` limited to 3 reqs / 10s), automatically throttling bots with `HTTP 429 Too Many Requests`.

### Containerized Multi-Stage Infrastructure
- Fully containerized with Docker multi-stage builds to optimize image size and build caching.
- Orchestrated via `docker-compose.yml` with health checks ensuring coordinated bootstrapping of PostgreSQL 16, Redis 7, and NestJS API.

---

## 3. Performance Benchmark (Autocannon)

Load-tested on a local setup simulating a flash sale traffic burst:

| Metric | Measured Value |
| :--- | :--- |
| **Peak Throughput** | **~5,830+ Requests / second** |
| **Total Requests Processed** | **~29,150 requests** (in 5-second burst) |
| **Concurrent Connections** | **50 connections** |
| **Average Latency** | **8.06 ms** |
| **Inventory Oversold** | **0 items (100% Data Integrity)** |

---

## 4. Tech Stack

- **Runtime and Framework:** Node.js 20, NestJS 12, TypeScript
- **Database and ORM:** PostgreSQL 16, Prisma ORM
- **In-Memory Store and Queues:** Redis 7 (via `ioredis`), BullMQ
- **Rate Limiting:** `@nestjs/throttler`, `@nest-lab/throttler-storage-redis`
- **DevOps and Tooling:** Docker, Docker Compose, Autocannon

---

## 5. Getting Started

### Prerequisites
- Docker and Docker Compose installed on your system.

### Installation and Launch

1. Clone the repository:
   ```bash
   git clone https://github.com/<your-username>/flashdeal-core.git
   cd flashdeal-core
   ```

2. Start the complete stack:
   ```bash
   docker compose up -d --build
   ```

3. Verify running containers:
   ```bash
   docker compose ps
   ```

4. Check application logs:
   ```bash
   docker logs -f flashdeal_api
   ```

The service will be listening at `http://localhost:3000`.

---

## 6. API Reference

### Create a Product
- **Endpoint:** `POST /products`
- **Payload:**
  ```json
  {
    "name": "iPhone 16 Pro Max",
    "description": "Flash Sale Event Unit",
    "price": 1299.99,
    "initialStock": 50
  }
  ```

### Get Products
- **Endpoint:** `GET /products`

### Place Flash Sale Order
- **Endpoint:** `POST /orders`
- **Rate Limit:** 3 requests / 10 seconds per IP
- **Payload:**
  ```json
  {
    "productId": "PRODUCT_UUID_HERE",
    "userId": "USER_UUID_HERE",
    "quantity": 1
  }
  ```

---

## 7. License

This project is licensed under the [MIT License](LICENSE).