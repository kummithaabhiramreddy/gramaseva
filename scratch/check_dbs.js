const { Client } = require('pg');
require('dotenv').config();

async function checkDbs() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL.replace('/gramaseva', '/postgres')
    });
    try {
        await client.connect();
        const res = await client.query('SELECT datname FROM pg_database');
        console.log("Databases found on this server:");
        res.rows.forEach(row => console.log("- " + row.datname));
    } catch (err) {
        console.error("Error:", err.message);
    } finally {
        await client.end();
    }
}

checkDbs();
