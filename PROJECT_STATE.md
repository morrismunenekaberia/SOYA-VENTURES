# Soya Ventures - Project State & Architecture Documentation

**Last Updated:** 2026-10-21 (Task 4 Completed: Business APIs)  
**Project Path:** `/home/swe-dev/Projects/Flutter_app/Soya_Ventures`  
**Purpose:** Single source of truth for developers and AI agents to continue work seamlessly.

---

## 1. Executive Summary & Objective

Soya Ventures is a multi-platform sales, inventory, downline referral commission, and M-Pesa payout management system.
- **Frontend:** Flutter mobile/desktop app (`SoyaVentures/`).
- **Backend:** Node.js, Express 5, PostgreSQL (`pg` connection pool), `dotenv`, `bcryptjs`, `jsonwebtoken`.
- **Target Roles:**
  1. `admin`: Global configuration, financials, creating privileged accounts, payout authorization, product/center management.
  2. `manager`: Regional oversight, restocking approvals, analytics.
  3. `center`: Center Hub Operator holding local inventory, receiving restocking, fulfilling agent stock requests.
  4. `agent`: Direct sales force, picks up inventory, records sales, earns direct commissions and 1-tier downline referral overrides.

---

## 2. Technology Stack & Database Migrations

- **Node.js:** v24.21.0 | **npm:** 11.19.0
- **PostgreSQL:** Running on port 5432, accepting connections.
- **Migrations Applied (`backend/Database/migrations/`):**
  1. `001_initial_baseline.sql`: Core baseline tables.
  2. `002_users_and_referrals.sql`: Phone number, active flags, referral constraints.
  3. `003_inventory_and_orders.sql`: Order types, audit timestamps, stock movements ledger.
  4. `004_payouts_ledger.sql`: Payout batches, payout items, commission status, duplicate payout prevention.
  5. `005_audit_logs.sql`: Audit logs with secret scrubbing check constraints.
  6. `006_performance_indexes.sql`: Foreign keys, status columns, and timestamp indexes.
  7. `007_create_order_items.sql`: Multi-product line items table (`order_items`), header enhancements (`orders.total_amount`, `orders.center_id`), and product base commission (`products.commission_per_unit`).

---

## 3. Business API Endpoints Reference

### 3.1 Product Catalog (`/api/products`)

| Method | Endpoint | Access Role | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/products` | Public / Auth | List active products (Admins can pass `?include_inactive=true`) |
| `GET` | `/api/products/:id` | Public / Auth | Retrieve single product details |
| `POST` | `/api/products` | `admin` | Create product (`name`, `price > 0`, `sku`, `commission_per_unit`) |
| `PUT` | `/api/products/:id` | `admin` | Update product details |
| `DELETE` | `/api/products/:id` | `admin` | Soft-deactivate product (`is_active = false`) |

### 3.2 Centers & Hub Inventory (`/api/centers` & `/api/inventory`)

| Method | Endpoint | Access Role | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/centers` | Auth | List centers |
| `GET` | `/api/centers/:id` | Auth | Center hub details |
| `POST` | `/api/centers` | `admin` | Create new center hub (`name`, `location`, `contact_phone`) |
| `PUT` | `/api/centers/:id` | `admin` | Update center hub details |
| `DELETE` | `/api/centers/:id` | `admin` | Soft-deactivate center hub |
| `GET` | `/api/inventory` | Scoped | View stock for permitted center (Admin/Manager any center; Agent/Center confined to assigned hub) |
| `GET` | `/api/inventory/center/:centerId` | Scoped | View stock for specific center (scoped) |
| `GET` | `/api/inventory/center/:centerId/product/:productId` | Scoped | View single product quantity at center |
| `POST` | `/api/inventory/restock` | `admin`, `manager` | Restock center inventory with atomic transaction and `stock_movements` ledger entry |

### 3.3 Hierarchical Multi-Item Orders (`/api/orders`)

| Method | Endpoint | Access Role | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/orders` | `agent`, `center` | Create hierarchical multi-item order (`items: [{ product_id, quantity }]`) |
| `GET` | `/api/orders` | Scoped | List orders (Agent sees own; Center sees hub; Manager sees replenishments; Admin sees all) |
| `GET` | `/api/orders/:id` | Scoped | Get order details with line items |
| `PUT` | `/api/orders/:id/status` | Scoped Reviewer | Transition order status (`approved`, `rejected`, `fulfilled`, `cancelled`) |

**Order Hierarchy & Concurrency Rules:**
1. **Agent-to-Center (`agent_to_center`):**
   - Placed by `agent` to restock from their assigned center hub.
   - Status transitions: `pending` $\rightarrow$ `approved` $\rightarrow$ `fulfilled`.
   - **Self-Approval Forbidden:** An agent cannot approve or fulfill their own order.
   - Reviewer must be `center` operator for that hub or `admin`/`manager`.
   - On fulfillment, center stock is locked with `SELECT ... FOR UPDATE` and deducted. Fails with `400 INSUFFICIENT_STOCK` if hub balance is lower than requested.
2. **Center-to-Manager (`center_to_manager`):**
   - Placed by `center` operator requesting replenishment from a manager.
   - Reviewer must be `manager` or `admin`.
   - On fulfillment, stock is added to the center hub and recorded in `stock_movements`.

### 3.4 Sales & Commission Engine (`/api/sales` & `/api/commissions`)

| Method | Endpoint | Access Role | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/sales` | `agent` | Record product sale, deduct center stock atomically, generate commissions |
| `GET` | `/api/sales` | Scoped | List sales (Agent sees own; Center sees hub; Admin/Manager sees all) |
| `GET` | `/api/commissions` | Scoped | List commissions (Agent sees own; Admin/Manager sees all) |

**Sales & Commission Business Rules:**
- **Trusted Pricing:** Client-supplied prices and commission figures are strictly ignored. Product unit price is loaded directly from PostgreSQL with row lock (`FOR UPDATE`).
- **Inventory Source:** Stock is automatically verified and deducted from the agent's assigned Center Hub (`users.center_id`).
- **Direct Commission:** Calculated as a fixed rate per unit sold (e.g. `agent.commission_rate * quantity` or falling back to `product.commission_per_unit * quantity`, default 50.00 KES/unit).
- **1-Level Recruiter Override Bonus:** If the selling agent was recruited by an active uplink agent (`users.recruiter_id`), an override commission of **5% of the total sale amount** is awarded to the recruiter.
- **Single-Tier Override Limit:** Enforced by PostgreSQL unique index `uq_commissions_sale_type (sale_id, type)` preventing multi-tier override creep.

---

## 4. Verification & Automated Test Results

The backend contains a complete automated integration test suite:

```bash
$ npm test --prefix backend

▶ Database Schema & Constraint Verification
  ✔ All migrations are marked as applied in schema_migrations (16.0ms)
  ✔ All expected tables exist in public schema (10.2ms)
  ✔ User self-referral constraint prevents user from recruiting themselves (17.3ms)
  ✔ Commissions table strictly limits sales to at most 1 direct and 1 override commission (16.5ms)
  ✔ Payout items cannot include the same commission in multiple active payouts (16.8ms)
  ✔ Audit log table rejects credentials and passwords in new_values and old_values (8.9ms)

▶ Authentication, Validation, RBAC & Rate Limiting (18 tests passing)
  ✔ Input validation (name, email, password, MSISDN phone)
  ✔ Public registration role enforcement (strictly forces 'agent')
  ✔ Conflict handling (duplicate email/phone)
  ✔ JWT authentication and profile extraction (/api/auth/me)
  ✔ RBAC administrative user creation (/api/users)
  ✔ Rate limiting protection (429 Too Many Requests)

▶ Soya Ventures Business APIs (18 tests passing)
  ✔ Product creation, duplicate SKU rejection, price updates, deactivation
  ✔ Center creation and scoped inventory access (cross-center access forbidden)
  ✔ Administrative center restocking and audit ledger tracking
  ✔ Multi-line orders (agent_to_center), self-approval prevention (403)
  ✔ Concurrency control & insufficient stock rejection on fulfillment
  ✔ Sales processing with trusted DB prices (client spoofed prices ignored)
  ✔ Automatic direct commission + 5% 1-tier recruiter override calculation
  ✔ Scoped commission visibility

▶ Health & Database Readiness Endpoints (3 tests passing)
  ✔ GET /api/health returns 200
  ✔ GET /api/health/db returns 200 with connection latency
  ✔ Unrecognized endpoints return 404 JSON

ℹ tests 45 | suites 13 | pass 45 | fail 0
```

---

## 5. Next Action Items (Task 5+)

1. **Task 5: Safaricom Daraja M-Pesa B2C Payout Integration**
   - `mpesaService`: Safaricom Daraja OAuth 2.0 token generation & caching.
   - B2C Initiator Password encryption with Safaricom's X.509 public key certificate.
   - Batch creation (`payout_batches`), bundling payable commissions.
   - Payout dispatch (`/mpesa/b2c/v1/paymentrequest`) and webhook callback handling (`/api/payouts/b2c/result`).
   - Idempotent state transitions: `pending` $\rightarrow$ `processing` $\rightarrow$ `success` / `failed`.
2. **Task 6: Logging, Hardening, and API Documentation (OpenAPI/Swagger or Postman Collection)**
