const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function check() {
    try {
        console.log("--- Workers ---");
        const workers = await pool.query('SELECT worker_id, full_name, phone FROM workers LIMIT 5');
        console.table(workers.rows);

        console.log("\n--- Bookings ---");
        const bookings = await pool.query('SELECT booking_id, worker_id, customer_name, customer_phone FROM bookings LIMIT 5');
        console.table(bookings.rows);

        await pool.end();
    } catch (err) {
        console.error(err);
    }
}

check();
