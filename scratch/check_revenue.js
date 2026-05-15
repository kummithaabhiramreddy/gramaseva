const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
    try {
        const result = await pool.query(`
            SELECT 
                SUM(CASE WHEN status = 'completed' AND amount ~ '[0-9]' 
                    THEN CAST(NULLIF(REGEXP_REPLACE(amount, '[^0-9.]', '', 'g'), '') AS NUMERIC) ELSE 0 END) as total_transaction_volume,
                SUM(CASE WHEN status = 'completed' AND amount ~ '[0-9]' 
                    THEN CAST(NULLIF(REGEXP_REPLACE(amount, '[^0-9.]', '', 'g'), '') AS NUMERIC) * 0.01 ELSE 0 END) as total_welfare
            FROM bookings
        `);
        console.log("Total Transaction Volume from Completed Bookings: ₹" + result.rows[0].total_transaction_volume);
        console.log("Total Platform Revenue (1% Welfare Fee): ₹" + result.rows[0].total_welfare);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
check();
