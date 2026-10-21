-- Migration 004: Payout Ledger and Enhanced Commissions
-- Implements payout batches, individual payout items, Daraja B2C tracking,
-- commission statuses, and enforces that a commission cannot be included in
-- multiple active/successful payouts or have more than one override per sale.

-- 1. Create payout_batches table
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

-- 2. Create payout_items table
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

-- 3. Enhance commissions table
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'payable';
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS payout_item_id INTEGER REFERENCES payout_items(id) ON DELETE SET NULL;
ALTER TABLE commissions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'commissions_status_check'
    ) THEN
        ALTER TABLE commissions ADD CONSTRAINT commissions_status_check
            CHECK (status IN ('pending', 'payable', 'processing', 'paid', 'cancelled'));
    END IF;
END $$;

-- 4. Constraint: Enforce max 1 override commission and 1 direct commission per sale
-- This mathematically ensures a maximum of 1 recruiter override level per sale.
CREATE UNIQUE INDEX IF NOT EXISTS uq_commissions_sale_type 
ON commissions (sale_id, type);

-- 5. Constraint: Prevent the same commission from being included in multiple successful or active payouts
CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_items_active_commission
ON payout_items (commission_id)
WHERE commission_id IS NOT NULL AND status IN ('pending', 'processing', 'success');

