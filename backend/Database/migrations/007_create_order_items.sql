-- Migration 007: Multi-Product Orders & Product Commission Config
-- 1. Creates order_items table for multi-line orders
-- 2. Makes product_id and quantity nullable on orders header
-- 3. Adds total_amount and center_id to orders
-- 4. Adds commission_per_unit to products

-- 1. Enhance products with base commission per unit
ALTER TABLE products ADD COLUMN IF NOT EXISTS commission_per_unit NUMERIC(10,2) NOT NULL DEFAULT 50.00;

-- 2. Enhance orders header
ALTER TABLE orders ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN quantity DROP NOT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2) DEFAULT 0.00;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS center_id INTEGER REFERENCES centers(id);

-- 3. Create order_items table
CREATE TABLE IF NOT EXISTS order_items (
    id          SERIAL PRIMARY KEY,
    order_id    INTEGER REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
    product_id  INTEGER REFERENCES products(id) NOT NULL,
    quantity    INTEGER NOT NULL CHECK (quantity > 0),
    unit_price  NUMERIC(10,2) NOT NULL CHECK (unit_price > 0),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create performance indexes for order_items
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_center_id ON orders(center_id);

