-- Migration 003: Enhance Products, Inventory, Orders, and Sales
-- Adds order types (agent_to_center, center_to_manager), approval/fulfillment audit fields,
-- unit_price and center_id to sales, and creates the stock_movements audit ledger.

-- 1. Enhance products
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku VARCHAR(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'products_sku_key'
    ) THEN
        ALTER TABLE products ADD CONSTRAINT products_sku_key UNIQUE (sku);
    END IF;
END $$;

-- 2. Enhance orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type VARCHAR(30) DEFAULT 'agent_to_center';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_order_type_check'
    ) THEN
        ALTER TABLE orders ADD CONSTRAINT orders_order_type_check 
            CHECK (order_type IN ('agent_to_center', 'center_to_manager'));
    END IF;
END $$;

-- Update orders status check to include 'cancelled'
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check 
    CHECK (status IN ('pending', 'approved', 'rejected', 'fulfilled', 'cancelled'));

-- 3. Enhance sales
ALTER TABLE sales ADD COLUMN IF NOT EXISTS unit_price NUMERIC(10,2);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS center_id INTEGER REFERENCES centers(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sales_unit_price_check'
    ) THEN
        ALTER TABLE sales ADD CONSTRAINT sales_unit_price_check 
            CHECK (unit_price IS NULL OR unit_price > 0);
    END IF;
END $$;

-- 4. Create stock_movements ledger (Audit Trail for Inventory)
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

