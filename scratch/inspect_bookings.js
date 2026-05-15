const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function checkData() {
    try {
        const res = await pool.query("SELECT booking_id, amount, welfare_fee, status, is_escrow_released FROM bookings LIMIT 10");
        console.table(res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
checkData();
