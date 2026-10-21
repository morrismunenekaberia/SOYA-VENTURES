# Soya Ventures - Project State & Architecture Documentation

**Last Updated:** 2026-10-21 (Task 2 Completed)  
**Project Path:** `/home/swe-dev/Projects/Flutter_app/Soya_Ventures`  
**Purpose:** Single source of truth for the Soya Ventures backend, database, and integrations, structured for developers and AI agents to continue work seamlessly.

---

## 1. Executive Summary & Objective

Soya Ventures is a multi-platform sales, inventory, downline referral commission, and M-Pesa payout management system.
- **Frontend:** Flutter mobile/desktop app (`SoyaVentures/`).
- **Backend:** Node.js, Express 5, PostgreSQL (`pg` pool), `dotenv`.
- **Target Audience / Roles:**
  1. `admin`: Global system configuration, financials, user management, payout authorization.
  2. `manager`: Oversight, analytics, restocking approval, regional monitoring.
  3. `center`: Center Hub Operator holding local inventory, receiving restocking, fulfilling agent stock requests.
  4. `agent`: Direct sales force, picks up inventory, records sales, earns direct commissions and 1-tier downline referral override commissions.

---

## 2. Current Workspace & Git State

### 2.1 Git Status
- **Current Branch:** `main` (ahead of `origin/main` by 1 commit: `Add initial Express server setup with health-check endpoint`).
- **Remote:** `git@github.com:morrismunenekaberia/SOYA-VENTURES.git`
- **Working Tree:**
  - Modified: `backend/index.js`, `backend/package.json`, `backend/db.js`, `backend/Database/schema.sql`.
  - Created: `backend/Database/migrations/` (001 to 006), `backend/Database/migrate.js`, `backend/Database/SCHEMA_DOCUMENTATION.md`, `backend/Database/tests/migration.test.js`, `PROJECT_STATE.md`.

### 2.2 Security Alert: Tracked Secrets & Node Modules
> [!CAUTION]
> In commit `63abeb26229b1000d32e30060c320fbc115c7c59`, `backend/.env` (containing live DB credentials) and the entire `backend/node_modules/` folder were committed to Git!
> `backend/.gitignore` contained `env ` (with a trailing space, missing dot).
> 
> **Required Remediation (Before pushing upstream):**
> 1. Untrack `.env`: `git rm --cached backend/.env`
> 2. Untrack `node_modules`: `git rm -r --cached backend/node_modules`
> 3. Provide `backend/.env.example` with sanitized placeholder keys.
> 4. Update `backend/.gitignore` with proper exclusions (`.env`, `node_modules/`, `dist/`, `*.log`).
> 5. Rotate any exposed database passwords once un-tracked.

---

## 3. Technology Stack & Environment

- **Node.js:** v24.21.0
- **npm:** 11.19.0
- **PostgreSQL:** Running locally on port 5432, accepting connections.
- **Backend Dependencies (`backend/package.json`):**
  - `dotenv`: `^18.0.8`
  - `express`: `^5.3.0`
  - `pg`: `^8.23.1`
- **Database Status:** Connected and fully migrated! All 12 tables present (`centers`, `users`, `products`, `stock`, `orders`, `sales`, `commissions`, `stock_movements`, `payout_batches`, `payout_items`, `audit_logs`, `schema_migrations`). 0 business rows (clean).

---

## 4. Database Schema, Constraints & Migrations (Completed in Task 2)

### 4.1 Implemented Migrations (`backend/Database/migrations/`)
1. **`001_initial_baseline.sql`**: Baseline tables (`centers`, `users`, `products`, `stock`, `orders`, `sales`, `commissions`).
2. **`002_users_and_referrals.sql`**: Added `phone_number VARCHAR(20) UNIQUE`, `is_active`, default role `'agent'`, and `CHECK (recruiter_id IS NULL OR recruiter_id <> id)`.
3. **`003_inventory_and_orders.sql`**: Added `order_type` (`agent_to_center`, `center_to_manager`), `unit_price`, `center_id` to `sales`, and created `stock_movements` table.
4. **`004_payouts_ledger.sql`**: Created `payout_batches` and `payout_items`. Added `status` and `payout_item_id` to `commissions`.
   - **Enforces 1-tier override max**: `UNIQUE (sale_id, type)` on `commissions`.
   - **Prevents duplicate payouts**: `UNIQUE (commission_id) WHERE commission_id IS NOT NULL AND status IN ('pending', 'processing', 'success')` on `payout_items`.
5. **`005_audit_logs.sql`**: Created `audit_logs` table with DB-level check constraints forbidding storage of `password`, `token`, `secret`, or `security_credential`.
6. **`006_performance_indexes.sql`**: High-performance indexes across all foreign keys, status columns, and timestamp queries.

### 4.2 Migration Commands & Automated Tests
```bash
# Migration status check
npm run migrate:status --prefix backend

# Execute pending migrations in transactions
npm run migrate --prefix backend

# Dry run preview
npm run migrate:dry-run --prefix backend

# Automated schema & constraint test suite
npm test --prefix backend
```
Test results: **6 passed, 0 failed, 100% assertions verified**.

---

## 5. Next Steps for Implementation (Task 3+)

1. **Repository Hygiene (Recommended Next Action):**
   - Clean git index: remove `.env` and `node_modules` from tracking.
   - Configure `.env.example` and update `.gitignore`.
2. **Modular Express Architecture Setup:**
   - Create folder structure: `backend/config/`, `backend/middleware/`, `backend/controllers/`, `backend/services/`, `backend/routes/`.
3. **Authentication & Authorization Module:**
   - Public self-registration (enforced role: `agent`).
   - Admin user provisioning (creating `manager`, `center`, `admin`).
   - Password hashing (`bcryptjs`) & stateless JWT tokens (`jsonwebtoken`).
   - Role-based authorization middleware (`requireRole`).
4. **Inventory & Order Flow:**
   - Agent-to-center stock order placement and fulfillment with row-level locks (`SELECT ... FOR UPDATE`).
   - Center-to-manager restocking requests.
   - Immutable audit logging in `stock_movements`.
5. **Sales & Commission Engine:**
   - Atomic sale recording, stock deduction, and simultaneous calculation of direct commission + single-tier recruiter override.
6. **M-Pesa B2C Payout Integration:**
   - Safaricom Daraja API service (OAuth token caching, RSA credential encryption).
   - Batch creation, item dispatch, and idempotent callback handling.
