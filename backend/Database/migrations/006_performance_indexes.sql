-- Migration 006: Performance and Query Optimization Indexes
-- Adds indexes on foreign keys, status columns, and timestamp fields
-- to ensure optimal query performance as data scales.

-- Users
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_center ON users(center_id);
CREATE INDEX IF NOT EXISTS idx_users_recruiter ON users(recruiter_id);

-- Products
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);

-- Orders
CREATE INDEX IF NOT EXISTS idx_orders_requester ON orders(requester_id);
CREATE INDEX IF NOT EXISTS idx_orders_target ON orders(target_id);
CREATE INDEX IF NOT EXISTS idx_orders_product ON orders(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- Sales
CREATE INDEX IF NOT EXISTS idx_sales_agent ON sales(agent_id);
CREATE INDEX IF NOT EXISTS idx_sales_center ON sales(center_id);
CREATE INDEX IF NOT EXISTS idx_sales_product ON sales(product_id);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at DESC);

-- Commissions
CREATE INDEX IF NOT EXISTS idx_commissions_sale ON commissions(sale_id);
CREATE INDEX IF NOT EXISTS idx_commissions_earner ON commissions(earner_id);
CREATE INDEX IF NOT EXISTS idx_commissions_status ON commissions(status);
CREATE INDEX IF NOT EXISTS idx_commissions_payout_item ON commissions(payout_item_id);

-- Stock Movements
CREATE INDEX IF NOT EXISTS idx_stock_movements_center_prod ON stock_movements(center_id, product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at DESC);

-- Payout Batches & Items
CREATE INDEX IF NOT EXISTS idx_payout_batches_status ON payout_batches(status);
CREATE INDEX IF NOT EXISTS idx_payout_batches_manager ON payout_batches(initiating_manager_id);
CREATE INDEX IF NOT EXISTS idx_payout_items_batch ON payout_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_payout_items_recipient ON payout_items(recipient_id);
CREATE INDEX IF NOT EXISTS idx_payout_items_status ON payout_items(status);
CREATE INDEX IF NOT EXISTS idx_payout_items_daraja_txn ON payout_items(transaction_id);

-- Audit Logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

