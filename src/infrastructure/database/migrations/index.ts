import fs from 'fs';
import path from 'path';
import pool, { query, withTransaction } from '../pool';

export async function runMigrations(): Promise<void> {
  // Web, webhook-worker and outbox-worker may boot at the same time. Serialize
  // migration execution so two processes cannot apply the same migration concurrently.
  const lockClient = await pool.connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock($1)', [824731]);

    await lockClient.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const dir = __dirname;
    const applied = new Set<string>((await query('SELECT version FROM schema_migrations')).rows.map((row: any) => row.version));

    // Bootstrap legacy installations or brand-new databases from the original schema.
    if (!applied.has('000_initial_schema')) {
      const existing = await query(`SELECT to_regclass('public.users') AS users_table`);
      if (!existing.rows[0]?.users_table) {
        const sourceSchema = fs.existsSync(path.join(process.cwd(), 'src', 'infrastructure', 'database', 'schema.sql'))
          ? path.join(process.cwd(), 'src', 'infrastructure', 'database', 'schema.sql')
          : path.join(dir, '..', 'schema.sql');
        await withTransaction(async client => {
          await client.query(fs.readFileSync(sourceSchema, 'utf8'));
          await client.query('INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING', ['000_initial_schema']);
        });
      } else {
        await query('INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING', ['000_initial_schema']);
      }
      applied.add('000_initial_schema');
    }

    const files = fs.readdirSync(dir)
      .filter((name: string) => /^\d+_.+\.sql$/.test(name))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await withTransaction(async client => {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
      });
      console.log(`✅ Migration applied: ${file}`);
    }
  } finally {
    try {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [824731]);
    } finally {
      lockClient.release();
    }
  }
}
