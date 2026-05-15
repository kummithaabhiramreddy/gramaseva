const { Pool } = require('pg');
const pool = new Pool({
    connectionString: 'postgresql://postgres:admin123@localhost:5432/gramaseva',
});

async function check() {
    try {
        const res = await pool.query("SELECT full_name, phone, availability FROM workers LIMIT 10");
        console.table(res.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
check();
