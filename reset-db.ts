import { Pool } from 'pg';
import { config } from 'dotenv';
config({ path: '.env.local' });

async function reset() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    console.log('Database schema dropped and recreated.');
    process.exit(0);
}
reset().catch(console.error);
