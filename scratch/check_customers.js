const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function check() {
    try {
        const result = await pool.query(`
            SELECT 
                customer_name, customer_phone,
                COUNT(*) as total_bookings,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                SUM(CASE WHEN amount ~ '[0-9]' 
                    THEN CAST(NULLIF(REGEXP_REPLACE(amount, '[^0-9.]', '', 'g'), '') AS NUMERIC) 
                    ELSE 0 END) as total_spent,
                MAX(created_at) as last_booking
            FROM bookings
            GROUP BY customer_name, customer_phone
            ORDER BY total_bookings DESC
        `);
        console.log(result.rows);
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
check();
