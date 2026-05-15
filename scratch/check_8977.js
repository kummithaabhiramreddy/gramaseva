const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function check() {
    const res = await pool.query("SELECT * FROM workers WHERE phone = '8977213870'");
    console.log("Worker Found:", res.rows.length > 0);
    console.table(res.rows);
    
    const bkg = await pool.query("SELECT * FROM bookings WHERE worker_id IN (SELECT worker_id FROM workers WHERE phone = '8977213870')");
    console.log("Incoming Bookings Found:", bkg.rows.length);
    console.table(bkg.rows);
    
    await pool.end();
}
check();
