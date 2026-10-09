import pg from 'pg';
import { readFile } from 'node:fs/promises';

export async function createDatabase() {
  let pool;
  if (process.env.DATABASE_URL) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10,
      ...(process.env.DATABASE_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}) });
  } else if (process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE === 'true') {
    const { newDb } = await import('pg-mem');
    const memory = newDb();
    const adapter = memory.adapters.createPg();
    pool = new adapter.Pool();
    console.warn('DEMO MODE: data is temporary. Configure DATABASE_URL for persistence.');
  } else {
    throw new Error('DATABASE_URL is required. For temporary local testing only, set DEMO_MODE=true.');
  }
  await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  return pool;
}

export async function transaction(pool, fn) {
  const db = await pool.connect();
  try { await db.query('BEGIN'); const result = await fn(db); await db.query('COMMIT'); return result; }
  catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
