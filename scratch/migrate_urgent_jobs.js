const { Pool } = require('pg');
const pool = new Pool({
    connectionString: 'postgresql://postgres:admin123@localhost:5432/gramaseva',
});

async function migrate() {
    try {
        console.log("🚀 Starting urgent_jobs table migration...");
        
        // Add new columns to urgent_jobs if they don't exist
        await pool.query(`
            ALTER TABLE urgent_jobs 
            ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open',
            ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '12 hours'),
            ADD COLUMN IF NOT EXISTS claimed_by TEXT,
            ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP;
        `);
        
        console.log("✅ urgent_jobs table updated successfully.");
        
        // Also update any existing null statuses to 'open'
        const res = await pool.query("UPDATE urgent_jobs SET status = 'open' WHERE status IS NULL");
        console.log(`✅ Fixed ${res.rowCount} rows with NULL status.`);

        const res2 = await pool.query("UPDATE urgent_jobs SET expires_at = (created_at + INTERVAL '12 hours') WHERE expires_at IS NULL");
        console.log(`✅ Fixed ${res2.rowCount} rows with NULL expires_at.`);

    } catch (e) {
        console.error("❌ Migration failed:", e.message);
    } finally {
        await pool.end();
    }
}

migrate();
