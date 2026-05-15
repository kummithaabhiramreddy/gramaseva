// One-time migration: Convert all legacy availability values to 'available' or 'busy'
const { Pool } = require('pg');
const pool = new Pool({
    connectionString: 'postgresql://postgres:admin123@localhost:5432/gramaseva',
});

async function migrate() {
    try {
        // Show current values
        const before = await pool.query("SELECT full_name, phone, availability FROM workers");
        console.log("BEFORE migration:");
        console.table(before.rows);

        // Update all non-'busy' values to 'available'
        const result = await pool.query(
            "UPDATE workers SET availability = 'available' WHERE availability IS NULL OR availability != 'busy'"
        );
        console.log(`\n✅ Updated ${result.rowCount} workers to 'available'`);

        // Show after
        const after = await pool.query("SELECT full_name, phone, availability FROM workers");
        console.log("\nAFTER migration:");
        console.table(after.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
migrate();
