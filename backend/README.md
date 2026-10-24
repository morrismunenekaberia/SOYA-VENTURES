# Soya Ventures - Backend API Documentation

Welcome to the backend for **Soya Ventures**! This backend manages sales operations, hierarchical inventory, agent downline referral commissions, and automated Safaricom Daraja M-Pesa B2C payouts.

Designed with clean, beginner-friendly modular architecture using **Node.js**, **Express 5**, and **PostgreSQL** (`pg`), with zero heavy third-party framework overhead.

---

## Table of Contents
1. [Architecture & Folder Structure](#1-architecture--folder-structure)
2. [Prerequisites & Quickstart](#2-prerequisites--quickstart)
3. [Database Migrations](#3-database-migrations)
4. [API Endpoint Reference](#4-api-endpoint-reference)
5. [Safaricom Daraja B2C Setup & Webhooks](#5-safaricom-daraja-b2c-setup--webhooks)
6. [Logging, Hardening & Security](#6-logging-hardening--security)
7. [Running Automated Tests](#7-running-automated-tests)
8. [Troubleshooting Guide](#8-troubleshooting-guide)

---

## 1. Architecture & Folder Structure

The backend follows a strict separation of concerns so that business rules, database queries, and route handlers remain independent and easy to read:

```
backend/
├── config/             # App configuration, database pool, and structured logger
│   ├── env.js          # Startup validation of environment variables
│   ├── db.js           # PostgreSQL connection pooling via 'pg'
│   └── logger.js       # Structured, timestamped logger with data redaction
├── middleware/         # Express middleware interceptors
│   ├── requestLogger.js# Request duration & X-Request-Id correlation ID tracker
│   ├── auth.js         # JWT verification & active user verification
│   ├── rbac.js         # Role-based access control (admin, manager, center, agent)
│   ├── rateLimiter.js  # Sliding window brute-force rate limiter
│   └── errorHandler.js # Safe error sanitization (no leaked stack traces or SQL)
├── validation/         # Request input validation schemas & sanitizers
├── repositories/       # Transactional database queries & SQL state machines
│   ├── userRepository.js
│   ├── productRepository.js
│   ├── centerRepository.js
│   ├── inventoryRepository.js
│   ├── orderRepository.js
│   ├── saleRepository.js
│   └── payoutRepository.js
├── services/           # High-level business logic & third-party integrations
│   ├── authService.js  # Password hashing (bcrypt) & token creation (JWT)
│   ├── mpesaService.js # Safaricom Daraja OAuth 2.0 & B2C API client
│   └── payoutService.js# Payout batching, concurrency & webhook reconciliation
├── controllers/        # Request/response handlers
├── routes/             # REST route mappings mounted in app.js
├── Database/
│   ├── migrate.js      # Migration runner (supports status and dry-run)
│   ├── schema.sql      # Database schema overview
│   └── migrations/     # Ordered SQL migration scripts (001 to 007)
├── tests/              # Automated integration tests (node:test)
├── app.js              # Express application assembly
└── index.js            # Server entry point
```

### The Request Lifecycle
```
Client Request ──> requestLogger (assigns X-Request-Id)
               ──> express.json({ limit: '100kb' })
               ──> RateLimiter
               ──> Routes ──> authMiddleware (JWT) ──> rbacMiddleware (Roles)
                          ──> Validation
                          ──> Controller ──> Service ──> Repository (PostgreSQL)
               ──> errorHandler (Sanitized JSON error response)
```

---

## 2. Prerequisites & Quickstart

### Prerequisites
- **Node.js**: v20+ or v24+
- **PostgreSQL**: v14+ running locally on port `5432`

### Setup Instructions

1. **Clone & Navigate:**
   ```bash
   cd ~/Projects/Flutter_app/Soya_Ventures/backend
   ```

2. **Install Dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment:**
   Copy the example environment configuration:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and fill in your PostgreSQL credentials and JWT secret:
   ```env
   PORT=3000
   NODE_ENV=development
   LOG_LEVEL=debug
   LOG_FORMAT=pretty

   DB_USER=soya_dev_user
   DB_PASSWORD=your_actual_password
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=soya_ventures

   JWT_SECRET=super_secret_jwt_random_key_here
   ```

4. **Run Database Migrations:**
   ```bash
   npm run migrate
   ```

5. **Start Server:**
   - Development mode with auto-reload:
     ```bash
     npm run dev
     ```
   - Standard production start:
     ```bash
     npm start
     ```

6. **Verify Server Health:**
   ```bash
   curl http://localhost:3000/api/health
   curl http://localhost:3000/api/health/db
   ```

---

## 3. Database Migrations

The database schema is managed using incremental SQL migrations tracked in the `schema_migrations` table.

| Migration File | Description |
| :--- | :--- |
| `001_initial_baseline.sql` | Baseline tables (`centers`, `users`, `products`, `stock`, `orders`, `sales`, `commissions`). |
| `002_users_and_referrals.sql` | Adds MSISDN phone format, self-referral prevention constraint, and recruiter links. |
| `003_inventory_and_orders.sql` | Adds hierarchical order types, audit fields, and `stock_movements` ledger. |
| `004_payouts_ledger.sql` | Adds `payout_batches`, `payout_items`, and commission payout tracking. |
| `005_audit_logs.sql` | Adds `audit_logs` table with CHECK constraint scrubbing passwords from logs. |
| `006_performance_indexes.sql` | Indexes on foreign keys, order statuses, and created timestamps. |
| `007_create_order_items.sql` | Multi-line order items (`order_items`) and product base commission rate. |

### Migration Commands

- **Apply all pending migrations:**
  ```bash
  npm run migrate
  ```
- **Check migration status:**
  ```bash
  npm run migrate:status
  ```
- **Simulate migrations without applying (Dry Run):**
  ```bash
  npm run migrate:dry-run
  ```

---

## 4. API Endpoint Reference

All endpoints return consistent JSON envelopes:
- Success: `{ "success": true, "message": "...", "data": { ... } }`
- Error: `{ "success": false, "error": { "code": "...", "message": "..." } }`

### 4.1 Health & Diagnostics
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Public | Returns service uptime and memory usage. |
| `GET` | `/api/health/db` | Public | Pings PostgreSQL connection pool and returns latency in ms. |

### 4.2 Authentication & User Management
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Public | Self-registration. **Strictly forced to `agent` role.** |
| `POST` | `/api/auth/login` | Public | Authenticates user; returns JWT Bearer token. Rate-limited. |
| `GET` | `/api/auth/me` | Authenticated | Retrieves current logged-in user profile. |
| `POST` | `/api/users` | `admin` | Creates privileged accounts (`manager`, `center`, `agent`). |
| `GET` | `/api/users` | `admin` | Lists system users with filtering by role or center. |

### 4.3 Products Catalog
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/products` | Public / Auth | Lists active products (`?include_inactive=true` for admin). |
| `GET` | `/api/products/:id` | Public / Auth | Retrieves single product details. |
| `POST` | `/api/products` | `admin` | Creates new product (`name`, `sku`, `price > 0`, `commission_per_unit`). |
| `PUT` | `/api/products/:id` | `admin` | Updates product details and pricing. |
| `DELETE`| `/api/products/:id` | `admin` | Soft-deactivates product (`is_active = false`). |

### 4.4 Centers & Inventory Hubs
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/centers` | Authenticated | Lists Center Hubs. |
| `POST` | `/api/centers` | `admin` | Creates new Center Hub (`name`, `location`, `contact_phone`). |
| `GET` | `/api/inventory` | Scoped | Views stock for user's assigned center (Admin/Manager sees all). |
| `POST` | `/api/inventory/restock` | `admin`, `manager` | Restocks center stock with atomic `stock_movements` ledger entry. |

### 4.5 Orders (Hierarchical Multi-Line)
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/orders` | `agent`, `center` | Places multi-item order (`items: [{ product_id, quantity }]`). |
| `GET` | `/api/orders` | Scoped | Lists orders permitted for current role. |
| `GET` | `/api/orders/:id` | Scoped | Retrieves order details with line items. |
| `PUT` | `/api/orders/:id/status`| Scoped Reviewer | Transitions order status (`approved`, `rejected`, `fulfilled`, `cancelled`). |

> [!IMPORTANT]
> **Self-Approval Guard:** An agent cannot approve or fulfill their own order. Agent-to-Center orders must be approved by the Center Hub Operator. Center-to-Manager replenishment orders must be approved by a Manager or Admin.

### 4.6 Sales & Downline Referral Commissions
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/sales` | `agent` | Records product sale, checks & deducts center stock atomically, calculates trusted commissions. |
| `GET` | `/api/sales` | Scoped | Lists sales (Agent sees own; Center sees hub; Admin/Manager sees all). |
| `GET` | `/api/commissions` | Scoped | Lists commission records (`payable`, `processing`, `paid`). |

**Business Rules:**
- **Trusted Pricing:** Client-supplied prices are ignored; prices are read directly from PostgreSQL row locks (`FOR UPDATE`).
- **Direct Commission:** Earned by the selling agent (e.g. 50.00 KES/unit).
- **1-Level Recruiter Override Bonus:** If the selling agent was recruited by an active uplink agent (`users.recruiter_id`), the recruiter automatically earns a **5% override commission** on the total sale value.
- **Single-Tier Guard:** Database constraint `uq_commissions_sale_type (sale_id, type)` guarantees at most 1 direct and 1 override commission per sale, preventing multi-level pyramid creep.

### 4.7 Safaricom Daraja B2C Payouts
| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/payouts/batches` | `manager`, `admin` | Bundles eligible `payable` commissions into a payout batch. |
| `GET` | `/api/payouts/batches` | `manager`, `admin` | Lists payout batches and statuses. |
| `GET` | `/api/payouts/batches/:id` | `manager`, `admin` | Retrieves batch details with line items and Daraja tracking IDs. |
| `POST` | `/api/payouts/batches/:id/process` | `manager`, `admin` | Dispatches batch to Daraja (`?dry_run=true` validates without sending). |
| `POST` | `/api/payouts/items/:id/reconcile` | `manager`, `admin` | Reconciles missing or timed-out items (`mark_success` or `mark_failed`). |
| `POST` | `/api/payouts/b2c/result` | Webhook (Public) | Handles final transaction outcome callbacks from Safaricom. |
| `POST` | `/api/payouts/b2c/timeout` | Webhook (Public) | Receives timeout notices from Safaricom API gateway. |

---

## 5. Safaricom Daraja B2C Setup & Webhooks

### Shortcode Clarification (Important)
- **Shortcode `174379`** in Safaricom Sandbox is the **C2B (Customer to Business / STK Push)** paybill number. It is configured to *receive* money from customers, **not** to disburse outbound payments.
- **Shortcode `600988`** is the official standard **B2C (Business to Customer)** Sandbox shortcode (with initiator name `testapi` and command ID `BusinessPayment`).
- The backend configuration in `config/env.js` defaults to `600988` while supporting overrides via `MPESA_B2C_SHORTCODE`.

### Setting Up Local Webhook Testing with Ngrok
Safaricom Daraja requires publicly reachable HTTPS callback URLs to send transaction outcomes:

1. Start `ngrok`:
   ```bash
   ngrok http 3000
   ```
2. Copy the forwarding URL (e.g. `https://xyz-123.ngrok-free.app`).
3. Update `.env`:
   ```env
   MPESA_RESULT_URL=https://xyz-123.ngrok-free.app/api/payouts/b2c/result
   MPESA_TIMEOUT_URL=https://xyz-123.ngrok-free.app/api/payouts/b2c/timeout
   ```
4. Perform a dry-run test:
   ```bash
   curl -X POST http://localhost:3000/api/payouts/batches/1/process?dry_run=true \
     -H "Authorization: Bearer <MANAGER_JWT>"
   ```
5. When ready, dispatch live payouts:
   ```bash
   curl -X POST http://localhost:3000/api/payouts/batches/1/process \
     -H "Authorization: Bearer <MANAGER_JWT>"
   ```

### Idempotency & Uncertain Network Failures
- If an outbound request to Daraja suffers a socket or network timeout, the payout item remains in `processing`. The system **never** marks an uncertain request as `failed`, preventing double-payment risks.
- Webhooks received at `/api/payouts/b2c/result` are idempotent: duplicate callbacks for already finalized items are safely ignored.
- If a callback is delayed or missing, managers can manually reconcile the record using:
  ```bash
  curl -X POST http://localhost:3000/api/payouts/items/12/reconcile \
    -H "Authorization: Bearer <MANAGER_JWT>" \
    -H "Content-Type: application/json" \
    -d '{ "action": "mark_success", "transaction_id": "NLJ7RT61SV" }'
  ```

---

## 6. Logging, Hardening & Security

### Structured Logging
The backend includes a zero-dependency structured logger (`config/logger.js`) that records timestamped logs with correlation tracking:
- **`LOG_FORMAT=pretty`**: Clean, color-coded terminal output for local development.
- **`LOG_FORMAT=json`**: Structured single-line JSON output for production log aggregators.
- **`LOG_LEVEL`**: `debug`, `info`, `warn`, `error`, `silent`.

### Data Redaction & Privacy
The logger automatically scrubs sensitive keys before writing output:
- Passwords, hashes, JWT tokens, consumer secrets, and security credentials are replaced with `[REDACTED]`.
- Customer phone numbers are masked for privacy: `254712345678` $\rightarrow$ `254712***678`.

### Request Correlation (`X-Request-Id`)
Every incoming HTTP request is assigned a unique UUID `X-Request-Id` (or preserves an upstream tracing token if provided in the header). This correlation ID is included in all server log messages and echoed back in the response headers.

### Security Hardening
- **Payload Size Limiting**: `express.json({ limit: '100kb' })` blocks denial-of-service memory flooding.
- **Fingerprint Protection**: `app.disable('x-powered-by')` conceals server technology.
- **SQL Injection Prevention**: All queries use parameterized inputs (`$1, $2, ...`).
- **Safe Error Responses**: Operational and unhandled 500 errors return sanitized JSON without stack traces or SQL strings.

---

## 7. Running Automated Tests

The backend uses Node.js's built-in test runner (`node:test`) for fast, zero-dependency testing.

### Run All Tests
```bash
npm test
```

### Test Suites Included
1. **Database Schema & Constraints** (`Database/tests/migration.test.js`):
   - Validates all migrations are applied.
   - Verifies self-referral checks and audit password scrubbing constraints.
2. **Health Endpoints** (`tests/health.test.js`):
   - Health check uptime and PostgreSQL ping latency.
3. **Authentication, Validation & RBAC** (`tests/auth.test.js`):
   - Input format validation, password hashing, and token expiration.
   - Strict `agent` role enforcement on public registration.
   - Rate limiting brute-force protection (429).
4. **Business APIs** (`tests/business.test.js`):
   - Product catalog operations.
   - Scoped Center Hub inventory access.
   - Multi-line order workflows, concurrency locks, and self-approval prevention.
   - Sales processing with trusted PostgreSQL pricing and 1-tier override commissions.
5. **Safaricom Daraja Payouts** (`tests/payout.test.js`):
   - Eligible commission bundling and duplicate payout prevention.
   - Dry-run validation and live batch concurrency dispatch.
   - Webhook callback matching, duplicate replay safety, and manual reconciliation.
6. **Hardening & Security** (`tests/hardening.test.js`):
   - `X-Request-Id` correlation token generation and preservation.
   - 100kb request payload size limit rejection (413).
   - Structured logger password and phone number redaction.
   - Safe error responses and SQL injection resilience.

---

## 8. Troubleshooting Guide

### 1. `ECONNREFUSED 127.0.0.1:5432`
- **Cause**: PostgreSQL is not running or port 5432 is not accepting connections.
- **Fix**: Check PostgreSQL service:
  ```bash
  sudo systemctl status postgresql
  sudo systemctl start postgresql
  ```

### 2. `FATAL CONFIGURATION ERROR: Missing required environment variable(s)`
- **Cause**: One or more critical variables (`DB_USER`, `DB_PASSWORD`, `JWT_SECRET`, etc.) are missing from `.env`.
- **Fix**: Copy missing fields from `.env.example` into `.env`.

### 3. `403 Forbidden: Conflict of interest: You cannot approve or fulfill your own order`
- **Cause**: The user attempting to approve or fulfill an order is also the order's requester.
- **Fix**: Log in as the assigned Center Hub Operator (for agent orders) or a Manager/Admin (for restocking orders).

### 4. `400 Bad Request: Commission #X is not eligible for payout`
- **Cause**: The commission is either already `paid`, in `processing` within another active batch, or its recipient account is inactive.
- **Fix**: Query `GET /api/commissions` to check eligible commissions with status `payable`.

### 5. `413 Payload Too Large: Request payload exceeds maximum allowed size`
- **Cause**: The request body exceeded the 100kb security limit.
- **Fix**: Reduce payload size or upload large batches in smaller chunks.

---

## License
Proprietary & Confidential - Soya Ventures 2026.

