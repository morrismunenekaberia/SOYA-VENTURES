-- Migration 002: Enhance Users and Centers
-- Adds phone numbers for M-Pesa payouts, active flags, audit timestamps,
-- and enforces referral constraints (no self-referral, default agent role).

-- 1. Enhance centers
ALTER TABLE centers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE centers ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20);
ALTER TABLE centers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Enhance users
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Set default role to 'agent' for public registrations
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'agent';

-- Ensure phone_number is unique if provided
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_phone_number_key'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_phone_number_key UNIQUE (phone_number);
    END IF;
END $$;

-- Prevent circular / self-referral
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_no_self_referral'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_no_self_referral CHECK (recruiter_id IS NULL OR recruiter_id <> id);
    END IF;
END $$;

