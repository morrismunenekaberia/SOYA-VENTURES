/**
 * Soya Ventures - Database Migration Runner
 * 
 * Safely executes versioned SQL migrations in transactions.
 * Tracks applied migrations in the `schema_migrations` table.
 * 
 * Usage:
 *   node backend/Database/migrate.js           # Apply pending migrations
 *   node backend/Database/migrate.js --status  # Check migration status
 *   node backend/Database/migrate.js --dry-run # Preview pending migrations
 */

const fs = require('fs');
const path = require('path');
const pool = require('../db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query(
    'SELECT version, applied_at FROM schema_migrations ORDER BY id ASC'
  );
  return new Map(result.rows.map(r => [r.version, r.applied_at]));
}

async function run() {
  const args = process.argv.slice(2);
  const isStatus = args.includes('--status');
  const isDryRun = args.includes('--dry-run');

  const client = await pool.connect();

  try {
    await ensureMigrationTable(client);
    const applied = await getAppliedMigrations(client);

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found in', MIGRATIONS_DIR);
      return;
    }

    if (isStatus) {
      console.log('\n=== Migration Status ===');
      for (const file of files) {
        if (applied.has(file)) {
          console.log(`[APPLIED]  ${file}  (at ${applied.get(file).toISOString()})`);
        } else {
          console.log(`[PENDING]  ${file}`);
        }
      }
      console.log('========================\n');
      return;
    }

    const pending = files.filter(f => !applied.has(f));

    if (pending.length === 0) {
      console.log('Database is already up to date. No pending migrations.');
      return;
    }

    console.log(`Found ${pending.length} pending migration(s):`);
    for (const file of pending) {
      console.log(` - ${file}`);
    }

    if (isDryRun) {
      console.log('\n[DRY RUN] No changes were applied.');
      return;
    }

    console.log('\nApplying migrations...');

    for (const file of pending) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      console.log(`Applying: ${file}...`);

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`✓ Applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`✗ Migration failed in ${file}:`, err.message);
        throw err;
      }
    }

    console.log('\nAll migrations completed successfully.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});

