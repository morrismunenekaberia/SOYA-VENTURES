# Soya Ventures - Project State & Architecture Documentation

**Last Updated:** 2026-10-21 (Task 3 Completed: Backend Foundation)  
**Project Path:** `/home/swe-dev/Projects/Flutter_app/Soya_Ventures`  
**Purpose:** Single source of truth for developers and AI models to continue work seamlessly.

---

## 1. Executive Summary & Objective

Soya Ventures is a multi-platform sales, inventory, downline referral commission, and M-Pesa payout management system.
- **Frontend:** Flutter mobile/desktop app (`SoyaVentures/`).
- **Backend:** Node.js, Express 5, PostgreSQL (`pg` connection pool), `dotenv`, `bcryptjs`, `jsonwebtoken`.
- **Target Roles:**
  1. `admin`: Global configuration, financials, creating privileged accounts, payout authorization.
  2. `manager`: Oversight, analytics, restocking approvals, viewing agents.
  3. `center`: Center Hub Operator holding local inventory, receiving restocking, fulfilling agent stock requests.
  4. `agent`: Direct sales force, picks up inventory, records sales, earns direct commissions and 1-tier downline referral overrides.

---

## 2. Repository & Security Status

### 2.1 Git Hygiene & Security Remediation (Completed)
- **Sensitive files untracked:** `backend/.env` and `backend/node_modules/` were removed from Git index tracking (`git rm --cached`).
- **Git Ignore rules:** Updated `backend/.gitignore` and created root `.gitignore` to strictly exclude `.env`, `.env.*`, `node_modules/`, and logs.
- **Template provided:** Created [`backend/.env.example`](file:///home/swe-dev/Projects/Flutter_app/Soya_Ventures/backend/.env.example) containing safe placeholder configuration keys only.

---

## 3. Technology Stack & Runtime Configuration

- **Node.js:** v24.21.0
- **npm:** 11.19.0
- **Database:** PostgreSQL on port 5432, accepting connections.
- **Dependencies (`backend/package.json`):**
  - `express`: `^5.3.0`
  - `pg`: `^8.23.1`
  - `dotenv`: `^18.0.8`
  - `bcryptjs`: `^3.0.3`
  - `jsonwebtoken`: `^9.0.3`

---

## 4. Backend Modular Architecture

The backend foundation is structured into clean, understandable, and maintainable layers:

```
backend/
├── .env.example              # Environment variables template
├── .gitignore                # Git exclusion rules
├── package.json              # Scripts & dependencies
├── index.js                  # Entry point (port listener & graceful shutdown)
├── app.js                    # Express setup, middleware pipeline, route mounting
├── config/
│   ├── env.js                # Centralized env validation (fails fast if keys are missing)
│   └── db.js                 # PostgreSQL connection pool & readiness check query
├── middleware/
│   ├── auth.js               # JWT verification & req.user attachment
│   ├── rbac.js               # Role authorization (admin, manager, center, agent)
│   ├── rateLimiter.js        # In-memory sliding window rate limiter
│   ├── errorHandler.js       # Centralized error handler returning consistent JSON
│   └── requestLogger.js      # Console request logging with response latency (ms)
├── validation/
│   └── authValidation.js     # Sanitization, email regex, MSISDN phone normalization
├── repositories/
│   └── userRepository.js     # Parameterized SQL queries ($1, $2) for users
├── services/
│   └── authService.js        # Password hashing (bcrypt), token issuance, auth logic
├── controllers/
│   ├── healthController.js   # /api/health and /api/health/db
│   ├── authController.js     # /api/auth (register, login, me, admin create user)
│   └── userController.js     # /api/users (administrative user management)
├── routes/
│   ├── healthRoutes.js       # GET /api/health, GET /api/health/db
│   ├── authRoutes.js         # POST /api/auth/register, POST /api/auth/login, GET /api/auth/me
│   └── userRoutes.js         # GET /api/users, POST /api/users, GET /api/users/:id
├── Database/
│   ├── schema.sql            # Consolidated schema reference
│   ├── SCHEMA_DOCUMENTATION.md # Detailed schema documentation
│   ├── migrate.js            # Transactional migration runner
│   ├── migrations/           # Versioned SQL migrations (001 to 006)
│   └── tests/                # Database schema & constraint tests
└── tests/
    ├── health.test.js        # Health and database readiness tests
    └── auth.test.js          # Auth, validation, RBAC, and rate limiting tests
```

---

## 5. Implemented Endpoints & Security Controls

| Method | Endpoint | Access Control | Rate Limited | Description |
| :--- | :--- | :--- | :---: | :--- |
| `GET` | `/api/health` | Public | No | API operational status & server timestamp |
| `GET` | `/api/health/db` | Public | No | PostgreSQL readiness check (`SELECT 1`) with latency ms |
| `POST` | `/api/auth/register` | Public | **Yes (20/15m)** | Public registration strictly restricted to `agent` role |
| `POST` | `/api/auth/login` | Public | **Yes (20/15m)** | Validates email/password and returns signed JWT token |
| `GET` | `/api/auth/me` | Bearer Token | No | Returns authenticated user's profile |
| `GET` | `/api/users` | Admin, Manager | No | Paginated list of users |
| `POST` | `/api/users` | Admin only | No | Creates privileged accounts (`manager`, `center`, `admin`) |
| `GET` | `/api/users/:id` | Admin, Manager | No | Fetches user details by ID |
| `GET` | `/api/products` | Public | No | Read-only product listing |

### 5.1 Consistent JSON Envelope Standard
- **Success Responses:**
  ```json
  {
    "success": true,
    "message": "Optional descriptive status",
    "data": { ... }
  }
  ```
- **Error Responses:**
  ```json
  {
    "success": false,
    "error": {
      "code": "ERROR_CODE",
      "message": "Safe human-readable message without raw SQL or secrets"
    }
  }
  ```

---

## 6. How to Configure, Run, and Test the Backend

### 6.1 Configuration
1. Copy the example configuration file:
   ```bash
   cp backend/.env.example backend/.env
   ```
2. Populate the required database credentials and generate a secure `JWT_SECRET` (e.g., `openssl rand -hex 32`).

### 6.2 Running Database Migrations
```bash
# Check migration status
npm run migrate:status --prefix backend

# Apply pending migrations inside transactions
npm run migrate --prefix backend
```

### 6.3 Starting the Server
```bash
# Start in production mode
npm start --prefix backend

# Start in development mode with native file watching
npm run dev --prefix backend
```
The server will start listening at `http://0.0.0.0:3000`.

### 6.4 Stopping the Server
Press `Ctrl+C` (or send `SIGINT` / `SIGTERM`). The application catches these signals and performs a graceful shutdown:
1. Closes the HTTP server to refuse new requests.
2. Drains and closes the PostgreSQL connection pool.
3. Exits cleanly with status code `0`.

### 6.5 Running Automated Tests
```bash
npm test --prefix backend
```
Test execution runs all test suites under `backend/Database/tests/` and `backend/tests/`:
- **Database Schema & Constraints:** 6 tests passing.
- **Authentication, Validation, RBAC & Rate Limiting:** 18 tests passing.
- **Health & Readiness:** 3 tests passing.
- **Total:** **27 passing tests, 0 failures**.

---

## 7. Next Action Items (Task 4+)

1. **Task 4: Product Catalog, Hub Inventory & Restocking Orders**
   - Products CRUD with SKU management.
   - Hub inventory tracking and stock adjustments.
   - Hierarchical orders:
     - Agent $\rightarrow$ Center orders (`pending` $\rightarrow$ `approved` $\rightarrow$ `fulfilled`).
     - Center $\rightarrow$ Manager restocking replenishment.
     - Row-level locking with `SELECT ... FOR UPDATE` and immutable ledger logging in `stock_movements`.
2. **Task 5: Sales & Commission Engine**
   - Atomic sale recording with stock deduction.
   - Automated calculation of direct commission + 1-level recruiter override bonus.
3. **Task 6: Safaricom Daraja M-Pesa B2C Payout Integration**
   - OAuth 2.0 token caching and Daraja Initiator Password RSA encryption.
   - Payout batch creation, dispatch, and callback handling.
