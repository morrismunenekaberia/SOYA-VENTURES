-- Soya Ventures - Complete Consolidated PostgreSQL Schema
-- Note: Migrations are tracked and applied via `npm run migrate` (Database/migrations/)

-- 1. Centers: pickup hubs where agents pick up products
CREATE TABLE IF NOT EXISTS centers (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  location      VARCHAR(150),
  contact_phone VARCHAR(20),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Users: admin, manager, center operator, and agent accounts
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  full_name       VARCHAR(100) NOT NULL,
  email           VARCHAR(100) UNIQUE NOT NULL,
  phone_number    VARCHAR(20) UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  role            VARCHAR(20) NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'manager', 'center', 'agent')),
  center_id       INTEGER REFERENCES centers(id),
  recruiter_id    INTEGER REFERENCES users(id),
  commission_rate NUMERIC(5,2) DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT users_no_self_referral CHECK (recruiter_id IS NULL OR recruiter_id <> id)
);

-- 3. Products: items the brand sells
CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  sku         VARCHAR(50) UNIQUE,
  name        VARCHAR(100) NOT NULL,
  price       NUMERIC(10,2) NOT NULL CHECK (price > 0),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Stock: quantity of each product currently held at each center
CREATE TABLE IF NOT EXISTS stock (
  center_id   INTEGER REFERENCES centers(id),
  product_id  INTEGER REFERENCES products(id),
  quantity    INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (center_id, product_id)
);

-- 5. Stock Movements: immutable inventory audit ledger
CREATE TABLE IF NOT EXISTS stock_movements (
  id              SERIAL PRIMARY KEY,
  center_id       INTEGER REFERENCES centers(id) NOT NULL,
  product_id      INTEGER REFERENCES products(id) NOT NULL,
  change_quantity INTEGER NOT NULL CHECK (change_quantity <> 0),
  balance_after   INTEGER NOT NULL CHECK (balance_after >= 0),
  movement_type   VARCHAR(30) NOT NULL CHECK (
    movement_type IN ('initial', 'restock', 'order_fulfillment', 'order_receipt', 'sale', 'adjustment', 'return')
  ),
  reference_type  VARCHAR(30) CHECK (reference_type IN ('order', 'sale', 'manual', 'transfer')),
  reference_id    INTEGER,
  performed_by    INTEGER REFERENCES users(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Orders: hierarchical stock requests (Agent -> Center, Center -> Manager)
CREATE TABLE IF NOT EXISTS orders (
  id           SERIAL PRIMARY KEY,
  order_type   VARCHAR(30) NOT NULL DEFAULT 'agent_to_center' CHECK (order_type IN ('agent_to_center', 'center_to_manager')),
  requester_id INTEGER REFERENCES users(id) NOT NULL,
  target_id    INTEGER REFERENCES users(id) NOT NULL,
  product_id   INTEGER REFERENCES products(id) NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  status       VARCHAR(20) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected', 'fulfilled', 'cancelled')),
  approved_by  INTEGER REFERENCES users(id),
  approved_at  TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ,
  notes        TEXT,
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Sales: each product sale recorded by an agent
CREATE TABLE IF NOT EXISTS sales (
  id             SERIAL PRIMARY KEY,
  agent_id       INTEGER REFERENCES users(id) NOT NULL,
  center_id      INTEGER REFERENCES centers(id),
  product_id     INTEGER REFERENCES products(id) NOT NULL,
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  unit_price     NUMERIC(10,2) CHECK (unit_price IS NULL OR unit_price > 0),
  total          NUMERIC(10,2) NOT NULL CHECK (total > 0),
  customer_phone VARCHAR(20),
  created_at     TIMESTAMP DEFAULT NOW()
);

-- 8. Payout Batches: managerial disbursements to groups of recipients
CREATE TABLE IF NOT EXISTS payout_batches (
  id                    SERIAL PRIMARY KEY,
  batch_reference       VARCHAR(64) UNIQUE NOT NULL,
  initiating_manager_id INTEGER REFERENCES users(id) NOT NULL,
  status                VARCHAR(25) NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'pending', 'processing', 'completed', 'partially_completed', 'failed', 'cancelled')
  ),
  total_amount          NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (total_amount >= 0),
  item_count            INTEGER NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  currency              VARCHAR(3) NOT NULL DEFAULT 'KES',
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

-- 9. Commissions: money earned from sales (direct or recruiter override)
CREATE TABLE IF NOT EXISTS commissions (
  id             SERIAL PRIMARY KEY,
  sale_id        INTEGER REFERENCES sales(id) NOT NULL,
  earner_id      INTEGER REFERENCES users(id) NOT NULL,
  type           VARCHAR(10) NOT NULL CHECK (type IN ('direct', 'override')),
  amount         NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  status         VARCHAR(20) NOT NULL DEFAULT 'payable' CHECK (
    status IN ('pending', 'payable', 'processing', 'paid', 'cancelled')
  ),
  payout_item_id INTEGER,
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Constraint: strictly enforces max 1 override commission and 1 direct commission per sale
CREATE UNIQUE INDEX IF NOT EXISTS uq_commissions_sale_type ON commissions (sale_id, type);

-- 10. Payout Items: individual Daraja B2C payout transactions
CREATE TABLE IF NOT EXISTS payout_items (
  id                         SERIAL PRIMARY KEY,
  batch_id                   INTEGER REFERENCES payout_batches(id) ON DELETE RESTRICT NOT NULL,
  recipient_id               INTEGER REFERENCES users(id) NOT NULL,
  phone_number               VARCHAR(20) NOT NULL,
  commission_id              INTEGER REFERENCES commissions(id) ON DELETE RESTRICT,
  amount                     NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  currency                   VARCHAR(3) NOT NULL DEFAULT 'KES',
  payout_reference           VARCHAR(64) UNIQUE NOT NULL,
  originator_conversation_id VARCHAR(100),
  conversation_id            VARCHAR(100),
  transaction_id             VARCHAR(100),
  status                     VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'success', 'failed')
  ),
  result_code                INTEGER,
  result_desc                TEXT,
  raw_callback               JSONB,
  created_at                 TIMESTAMPTZ DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ DEFAULT NOW(),
  processed_at               TIMESTAMPTZ
);

-- Foreign key link back from commissions to payout_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'commissions_payout_item_id_fkey'
  ) THEN
    ALTER TABLE commissions ADD CONSTRAINT commissions_payout_item_id_fkey
      FOREIGN KEY (payout_item_id) REFERENCES payout_items(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Constraint: prevents the same commission from being added to multiple active/successful payouts
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_items_active_commission
ON payout_items (commission_id)
WHERE commission_id IS NOT NULL AND status IN ('pending', 'processing', 'success');

-- 11. Audit Logs: system-wide administrative & financial audit log
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id   VARCHAR(64),
  old_values  JSONB,
  new_values  JSONB,
  ip_address  VARCHAR(45),
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT audit_no_secrets_in_new_values CHECK (
    new_values IS NULL OR NOT (
      new_values ? 'password' OR 
      new_values ? 'password_hash' OR 
      new_values ? 'token' OR 
      new_values ? 'access_token' OR 
      new_values ? 'secret' OR
      new_values ? 'security_credential'
    )
  ),
  CONSTRAINT audit_no_secrets_in_old_values CHECK (
    old_values IS NULL OR NOT (
      old_values ? 'password' OR 
      old_values ? 'password_hash' OR 
      old_values ? 'token' OR 
      old_values ? 'access_token' OR 
      old_values ? 'secret' OR
      old_values ? 'security_credential'
    )
  )
);
