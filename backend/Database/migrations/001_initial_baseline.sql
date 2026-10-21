-- Migration 001: Initial Baseline Schema
-- Idempotent baseline matching the initial tables defined for Soya Ventures.
-- Safe to execute whether tables already exist or in a fresh database.

CREATE TABLE IF NOT EXISTS centers (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  location    VARCHAR(150),
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  full_name       VARCHAR(100) NOT NULL,
  email           VARCHAR(100) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  role            VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'manager', 'center', 'agent')),
  center_id       INTEGER REFERENCES centers(id),
  recruiter_id    INTEGER REFERENCES users(id),
  commission_rate NUMERIC(5,2) DEFAULT 0,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  price       NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock (
  center_id   INTEGER REFERENCES centers(id),
  product_id  INTEGER REFERENCES products(id),
  quantity    INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (center_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id           SERIAL PRIMARY KEY,
  requester_id INTEGER REFERENCES users(id) NOT NULL,
  target_id    INTEGER REFERENCES users(id) NOT NULL,
  product_id   INTEGER REFERENCES products(id) NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  status       VARCHAR(20) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected', 'fulfilled')),
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales (
  id          SERIAL PRIMARY KEY,
  agent_id    INTEGER REFERENCES users(id) NOT NULL,
  product_id  INTEGER REFERENCES products(id) NOT NULL,
  quantity    INTEGER NOT NULL CHECK (quantity > 0),
  total       NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commissions (
  id          SERIAL PRIMARY KEY,
  sale_id     INTEGER REFERENCES sales(id) NOT NULL,
  earner_id   INTEGER REFERENCES users(id) NOT NULL,
  type        VARCHAR(10) NOT NULL CHECK (type IN ('direct', 'override')),
  amount      NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

