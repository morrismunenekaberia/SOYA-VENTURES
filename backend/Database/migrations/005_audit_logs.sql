-- Migration 005: Audit Logs
-- Tracks critical financial and administrative operations with strict database-level
-- constraints preventing any sensitive credentials or secrets from ever being recorded.

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

    -- Enforce that secrets and credentials are NEVER stored in audit records
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

