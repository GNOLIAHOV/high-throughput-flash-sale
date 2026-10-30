# High-Throughput Flash Sale Engine (`flashdeal-core`)

[![NestJS](https://img.shields.io/badge/NestJS-12.x-E0234E?style=flat-square&logo=nestjs)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x%2F6.x-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7.x-DC382D?style=flat-square&logo=redis)](https://redis.io/)
[![BullMQ](https://img.shields.io/badge/BullMQ-6.x-FF6B6B?style=flat-square)](https://docs.bullmq.io/)
[![Docker](https://img.shields.io/badge/Docker-Multi--stage-2496ED?style=flat-square&logo=docker)](https://www.docker.com/)

A distributed, production-grade backend engine designed to handle high-concurrency ticket booking and flash sale events with **absolute inventory consistency**, **zero overselling**, and **sub-10ms response times**.

---

## 1. Problem Statement & Key Challenges

During high-profile flash sales or ticket release events, backend architectures typically encounter three catastrophic failure modes:

1. **Race Conditions & Overselling:** Thousands of concurrent requests attempt to reserve limited inventory at the exact same millisecond. Traditional relational database transactions (`SELECT FOR UPDATE` or serializable isolation) create extreme lock contention, deadlocks, and severe latency degradation.
2. **Database Bottlenecks & Connection Pool Exhaustion:** Direct read/write traffic hitting persistent storage (PostgreSQL) quickly depletes the database connection pool, leading to cascading HTTP 500 errors and total system collapse.
3. **Duplicate Submissions & Scalper Bot Traffic:** Users repeatedly spamming the checkout button during network lag and automated scalper bots spamming endpoints can deplete inventory unfairly in milliseconds.

---

## 2. Architecture & Core Engineering Solutions

```text
[ Client Traffic / Bots ]
            │
            ▼
┌──────────────────────────────────────────────────────────────────┐
│ NestJS API Gateway                                               │
│  └── Throttler Guard (Redis Storage: 429 Too Many Requests)       │
└───────────────────────────────────┬──────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────┐
│ Atomic Inventory Guard (Redis RAM)                               │
│  └── Lua Script: check stock -> atomic decrby -> return status   │
│      ├── Return -1 : Product not open / missing                  │
│      ├── Return -2 : Out of stock (reject immediately)           │
│      └── Return >=0: Stock reserved atomically!                  │
└───────────────────────────────────┬──────────────────────────────┘
                                    │
                                    ▼ (Stock successfully reserved)
┌──────────────────────────────────────────────────────────────────┐
│ Asynchronous Order Offloading                                    │
│  ├── Idempotency Check (Duplicate request protection)            │
│  ├── Persist PENDING Order to PostgreSQL (with auto Redis refund)│
│  └── Enqueue job to BullMQ ('order-queue')                       │
└───────────────────────────────────┬──────────────────────────────┘
                                    │
                                    ▼ (Background processing)
┌──────────────────────────────────────────────────────────────────┐
│ BullMQ Worker (OrderProcessor)                                   │
│  ├── Deduct availableStock in PostgreSQL (Atomic transaction)    │
│  ├── Update Order status to 'SUCCESS'                            │
│  └── On Failure: Set 'FAILED' & automatically refund Redis stock │
└──────────────────────────────────────────────────────────────────┘
```

### 🔹 Atomic Concurrency Control (Single-Trip Redis Lua Script)
Instead of pessimistic row locking at the database level, inventory is decoupled into Redis RAM:
- Stock deduction is executed inside an atomic Redis Lua script.
- Redis's single-threaded event loop guarantees isolated execution without locks, completely eliminating race conditions and ensuring **zero overselling** at scale.
- Accurately handles the **last item in stock** (`remainingStock === 0`) without ghost deductions.

### 🔹 Automatic Redis Stock Rollback (Fault-Tolerant Compensation)
- If database order creation fails or BullMQ queue dispatch experiences network glitches, the system automatically triggers a compensation transaction (`redis.incrby`) to refund the inventory immediately.
- If the background worker fails to process the order in PostgreSQL, the worker marks the order as `FAILED` and refunds the exact quantity back to Redis.

### 🔹 Eventual Consistency via Message Queues (BullMQ)
- The API confirms the stock reservation in memory and enqueues the order payload to BullMQ.
- Background consumer workers asynchronously sync stock balances and order statuses into PostgreSQL in batches, keeping the HTTP checkout lifecycle ultra-fast and sub-10ms.

### 🔹 Idempotency & Rate Limiting
- **Idempotency Protection:** Clients can supply an `idempotencyKey`. If a duplicate request is received, the existing order is returned immediately without decrementing Redis inventory twice.
- **Distributed Rate Limiting:** Global rate limiting (`@nestjs/throttler`) backed by Redis storage protects endpoints against bot bursts with `HTTP 429 Too Many Requests`.

---

## 3. Performance Benchmark (Autocannon)

Load-tested simulating a severe flash sale traffic burst:

| Metric | Measured Value |
| :--- | :--- |
| **Peak Throughput** | **~5,830+ Requests / second** |
| **Total Requests Processed** | **~29,150 requests** (in 5-second burst) |
| **Concurrent Connections** | **50 connections** |
| **Average Latency** | **8.06 ms** |
| **Inventory Oversold** | **0 items (100% Data Integrity)** |

---

## 4. Tech Stack

- **Runtime & Framework:** Node.js 20+, NestJS 12.x, TypeScript
- **Database & ORM:** PostgreSQL 16, Prisma ORM
- **In-Memory Store & Queues:** Redis 7 (via `ioredis`), BullMQ 6.x
- **Rate Limiting:** `@nestjs/throttler`, `@nest-lab/throttler-storage-redis`
- **Testing & Benchmarking:** Jest, Autocannon, Supertest
- **DevOps:** Docker, Multi-Stage Dockerfile, Docker Compose

---

## 5. Project Directory Structure

```text
flashdeal-core/
├── prisma/
│   └── schema.prisma           # Prisma schema (Product, Inventory, Order, OrderItem)
├── scripts/                    # Performance & load testing scripts
│   ├── stress-test.js          # Autocannon high-concurrency benchmark script
│   └── test-throttle.js        # Burst request rate-limit tester
├── src/
│   ├── order/                  # Order management & flash sale checkout
│   │   ├── dto/
│   │   │   └── create-order.dto.ts
│   │   ├── order.controller.ts
│   │   ├── order.module.ts
│   │   ├── order.processor.ts  # BullMQ background consumer worker
│   │   ├── order.service.ts    # Lua script execution & fault-tolerant checkout
│   │   └── order.service.spec.ts # Comprehensive unit tests
│   ├── prisma/                 # Prisma client lifecycle service & module
│   │   ├── prisma.module.ts
│   │   ├── prisma.service.ts
│   │   └── prisma.service.spec.ts
│   ├── product/                # Product catalog & inventory synchronization
│   │   ├── dto/
│   │   │   └── create-product.dto.ts
│   │   ├── product.controller.ts
│   │   ├── product.module.ts
│   │   └── product.service.ts
│   ├── redis/                  # Redis connection provider & module
│   │   ├── redis.module.ts
│   │   ├── redis.service.ts
│   │   └── redis.service.spec.ts
│   ├── app.controller.ts       # Health check / base endpoint
│   ├── app.controller.spec.ts
│   ├── app.module.ts           # Root module with Throttler & BullMQ configuration
│   ├── app.service.ts
│   └── main.ts                 # Application bootstrap with global ValidationPipe
├── test/                       # End-to-end (E2E) integration test suite
│   ├── app.e2e-spec.ts
│   └── jest-e2e.json
├── docker-compose.yml          # Local multi-container orchestration (Postgres, Redis, API)
├── Dockerfile                  # Production-optimized multi-stage Docker build
├── package.json
└── tsconfig.json
```

---

## 6. Environment Variables

Create a `.env` file in the project root:

```env
# PostgreSQL Database URL
DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5432/flashdeal_db?schema=public"

# Redis Configuration
REDIS_HOST="localhost"
REDIS_PORT=6379

# Server Port
PORT=3000
```

---

## 7. Getting Started

### Option A: Running with Docker Compose (Recommended)

Start the entire stack (PostgreSQL, Redis, and NestJS API) with health-checked orchestration:

```bash
# 1. Build and start all services in detached mode
docker compose up -d --build

# 2. View container statuses
docker compose ps

# 3. Stream API logs
docker logs -f flashdeal_api
```

The service will be listening at `http://localhost:3000`.

---

### Option B: Local Development Setup

#### Prerequisites
- Node.js 20+ installed
- PostgreSQL 16 running on port `5432`
- Redis 7 running on port `6379`

#### Steps:
```bash
# 1. Clone repository
git clone https://github.com/<your-username>/flashdeal-core.git
cd flashdeal-core

# 2. Install dependencies
npm install

# 3. Synchronize database schema with Prisma
npx prisma db push

# 4. Start the application in development watch mode
npm run start:dev
```

---

## 8. Testing & Benchmarking

### Run Automated Unit Tests
```bash
npm test
```

### Run End-to-End (E2E) Integration Tests
```bash
npm run test:e2e
```

### Run High-Concurrency Stress Test
Simulates 50 concurrent connections hitting the flash sale order endpoint for 5 seconds:
```bash
npm run test:stress
```

### Run Throttling / Rate-Limit Test
Sends 5 rapid sequential requests to test the `429 Too Many Requests` limiter:
```bash
npm run test:throttle
```

---

## 9. API Reference

### 1. Create Product & Initialize Redis Stock
* **Endpoint:** `POST /products`
* **Request Body:**
  ```json
  {
    "name": "Sony PlayStation 5 Pro",
    "description": "Flash Sale Event Limited Edition",
    "price": 699.99,
    "initialStock": 100
  }
  ```
* **Response (201 Created):**
  ```json
  {
    "message": "Product created and inventory synced to Redis successfully",
    "data": {
      "id": "e5b8823f-1d89-4e58-8fc2-0266e7fbce6e",
      "name": "Sony PlayStation 5 Pro",
      "price": "699.99",
      "inventory": {
        "totalStock": 100,
        "availableStock": 100
      }
    }
  }
  ```

---

### 2. Get Product with Real-Time Redis Stock
* **Endpoint:** `GET /products/:id`
* **Response (200 OK):**
  ```json
  {
    "id": "e5b8823f-1d89-4e58-8fc2-0266e7fbce6e",
    "name": "Sony PlayStation 5 Pro",
    "price": "699.99",
    "inventory": {
      "totalStock": 100,
      "availableStock": 100
    },
    "realtimeStockInRedis": 100
  }
  ```

---

### 3. Place Flash Sale Order
* **Endpoint:** `POST /orders`
* **Rate Limit:** 3 requests / 10 seconds per client IP
* **Request Body:**
  ```json
  {
    "userId": "user_buyer_01",
    "productId": "e5b8823f-1d89-4e58-8fc2-0266e7fbce6e",
    "quantity": 1,
    "idempotencyKey": "order_idem_key_unique_123"
  }
  ```
* **Success Response (201 Created):**
  ```json
  {
    "message": "Đặt hàng thành công! Đơn hàng đã đưa vào hàng đợi xử lý.",
    "orderId": "b1a329d7-850c-4fa2-b2f5-25b88ce8c001",
    "remainingStockInRedis": 99
  }
  ```
* **Out of Stock Response (400 Bad Request):**
  ```json
  {
    "message": "Hàng trong kho đã hết (Out of stock)!",
    "error": "Bad Request",
    "statusCode": 400
  }
  ```
* **Rate Limited Response (429 Too Many Requests):**
  ```json
  {
    "statusCode": 429,
    "message": "ThrottlerException: Too Many Requests"
  }
  ```

---

## 10. License

This project is licensed under the [MIT License](LICENSE).
