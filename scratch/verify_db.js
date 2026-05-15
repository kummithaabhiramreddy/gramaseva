require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:admin123@localhost:5432/gramaseva',
});

async function check() {
    try {
        console.log("Checking database structure...");
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'bookings';
        `);
        console.table(res.rows);
        
        const count = await pool.query("SELECT COUNT(*) FROM bookings WHERE completion_otp IS NOT NULL");
        console.log(`Bookings with OTP: ${count.rows[0].count}`);
        
        await pool.end();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
