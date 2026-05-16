require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
const path = require('path');
app.use(express.static(path.join(__dirname, '../public')));

// Postgres Pool Setup
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost') 
         ? { rejectUnauthorized: false } 
         : false
});

// Error listener to prevent process crash
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
});

// Explicitly serve index.html on root just in case Vercel routes it here
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});


const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'dummy_key_id_to_prevent_crash',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_key_secret'
});

// Database Initialization (Optional: You might want to run this once separately or check if table exists)
const initDb = async () => {
    const query = `
        CREATE TABLE IF NOT EXISTS workers (
            id SERIAL PRIMARY KEY,
            worker_id TEXT UNIQUE,
            full_name TEXT NOT NULL,
            phone TEXT NOT NULL,
            trade TEXT NOT NULL,
            village TEXT NOT NULL,
            mandal TEXT,
            landmark TEXT,
            experience INTEGER,
            availability TEXT,
            details TEXT,
            type TEXT NOT NULL,
            leader_name TEXT,
            members_count INTEGER DEFAULT 1,
            rating FLOAT DEFAULT 4.5,
            reviews_count INTEGER DEFAULT 0,
            price_1 TEXT,
            price_2 TEXT,
            price_3 TEXT,
            working_hours TEXT,
            group_members TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS bookings (
            id SERIAL PRIMARY KEY,
            booking_id TEXT UNIQUE,
            worker_id TEXT NOT NULL,
            customer_name TEXT NOT NULL,
            customer_phone TEXT NOT NULL,
            customer_address TEXT NOT NULL,
            service_date DATE NOT NULL,
            status TEXT DEFAULT 'pending',
            payment_status TEXT DEFAULT 'pending',
            amount TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS urgent_jobs (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            phone TEXT,
            trade TEXT NOT NULL,
            village TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'open',
            expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '12 hours'),
            claimed_by TEXT,
            claimed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS otp_verifications (
            id SERIAL PRIMARY KEY,
            phone TEXT UNIQUE,
            otp TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    try {
        await pool.query(query);
        // Safely add new columns
        await pool.query(`
            ALTER TABLE workers 
            ADD COLUMN IF NOT EXISTS price_1 TEXT, 
            ADD COLUMN IF NOT EXISTS price_2 TEXT, 
            ADD COLUMN IF NOT EXISTS price_3 TEXT, 
            ADD COLUMN IF NOT EXISTS working_hours TEXT, 
            ADD COLUMN IF NOT EXISTS group_members TEXT,
            ADD COLUMN IF NOT EXISTS aadhaar_no TEXT,
            ADD COLUMN IF NOT EXISTS aadhaar_image TEXT,
            ADD COLUMN IF NOT EXISTS eshram_uan TEXT,
            ADD COLUMN IF NOT EXISTS account_type TEXT,
            ADD COLUMN IF NOT EXISTS account_no TEXT,
            ADD COLUMN IF NOT EXISTS ifsc_code TEXT,
            ADD COLUMN IF NOT EXISTS bank_name TEXT,
            ADD COLUMN IF NOT EXISTS account_name TEXT,
            ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS latitude TEXT,
            ADD COLUMN IF NOT EXISTS longitude TEXT;
        `).catch(e => console.log("Workers alter error ignored"));
        
        await pool.query(`
            ALTER TABLE bookings 
            ADD COLUMN IF NOT EXISTS welfare_fee TEXT,
            ADD COLUMN IF NOT EXISTS job_completed_at TIMESTAMP,
            ADD COLUMN IF NOT EXISTS completion_otp TEXT,
            ADD COLUMN IF NOT EXISTS is_escrow_released BOOLEAN DEFAULT FALSE,
            ALTER COLUMN amount TYPE TEXT;
        `).catch(e => console.log("Bookings alter error ignored"));

    } catch (err) {
        console.error("❌ Error initializing database:", err.message);
    }
};

// Run DB migration on cold start — safe because CREATE TABLE IF NOT EXISTS is idempotent
initDb();

// Also expose a manual migration endpoint
app.get('/api/migrate', async (req, res) => {
    try {
        await initDb();
        res.json({ success: true, message: 'Database tables created/verified successfully!' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API Endpoints

// 1. Get all workers with optional filtering
app.get('/api/workers', async (req, res) => {
    const { trade, village, search, availability } = req.query;
    let query = 'SELECT * FROM workers WHERE 1=1';
    const params = [];

    if (trade) {
        params.push(`%${trade}%`);
        query += ` AND trade ILIKE $${params.length}`;
    }
    if (village) {
        params.push(`%${village}%`);
        query += ` AND village ILIKE $${params.length}`;
    }
    if (search) {
        params.push(`%${search}%`);
        query += ` AND (full_name ILIKE $${params.length} OR trade ILIKE $${params.length} OR village ILIKE $${params.length})`;
    }
    if (availability && availability !== 'all') {
        params.push(availability);
        query += ` AND availability = $${params.length}`;
    }

    query += ' ORDER BY created_at DESC';

    try {
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get a specific worker by ID
app.get('/api/workers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Worker not found" });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Register a worker
app.post('/api/register', async (req, res) => {
    const query = `
        INSERT INTO workers (
            worker_id, full_name, phone, trade, village, mandal, 
            landmark, experience, availability, details, type, 
            leader_name, members_count, price_1, price_2, price_3, 
            working_hours, group_members, aadhaar_no, eshram_uan,
            account_type, account_no, ifsc_code, bank_name, account_name,
            latitude, longitude
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
        RETURNING *;
    `;
    const {
        worker_id, full_name, phone, trade, village, mandal,
        landmark, experience, availability, details, type,
        leader_name, members_count, price_1, price_2, price_3,
        working_hours, group_members, aadhaar_no, eshram_uan,
        account_type, account_no, ifsc_code, bank_name, account_name,
        latitude, longitude
    } = req.body;

    try {
        let final_worker_id = worker_id;
        let success = false;
        let result;

        while (!success) {
            try {
                result = await pool.query(query, [
                    final_worker_id, full_name, phone, trade, village, mandal,
                    landmark, experience || 0, availability, details, type,
                    leader_name, members_count || 1, price_1, price_2, price_3,
                    working_hours, group_members, aadhaar_no, eshram_uan,
                    account_type, account_no, ifsc_code, bank_name, account_name,
                    latitude, longitude
                ]);
                success = true;
            } catch (err) {
                if (err.code === '23505') { // Unique constraint violation
                    const lastResult = await pool.query("SELECT worker_id FROM workers WHERE type = $1 ORDER BY id DESC LIMIT 1", [type]);
                    let nextNum = (type === 'group' ? 341 : 1241);
                    if (lastResult.rows.length > 0) {
                        const parts = lastResult.rows[0].worker_id.split('-');
                        const num = parseInt(parts[parts.length - 1]);
                        if (!isNaN(num)) nextNum = num + 1;
                    }
                    final_worker_id = (type === 'group' ? 'GRP' : 'WRK') + '-2025-' + String(nextNum).padStart(4, '0');
                } else {
                    throw err;
                }
            }
        }
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update worker bank details
app.put('/api/workers/:id/bank-details', async (req, res) => {
    const { id } = req.params;
    const { account_type, bank_name, account_name, ifsc_code, account_no } = req.body;

    try {
        const query = `
            UPDATE workers 
            SET account_type = $1, bank_name = $2, account_name = $3, ifsc_code = $4, account_no = $5
            WHERE worker_id = $6
            RETURNING *;
        `;
        const result = await pool.query(query, [account_type, bank_name, account_name, ifsc_code, account_no, id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Worker not found" });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Stats
app.get('/api/stats', async (req, res) => {
    try {
        const totalWorkers = await pool.query('SELECT SUM(members_count) as total_count FROM workers');
        const totalVillages = await pool.query('SELECT COUNT(DISTINCT village) FROM workers');
        const totalGroups = await pool.query("SELECT COUNT(*) FROM workers WHERE type = 'group'");
        const completedJobsRes = await pool.query("SELECT COUNT(*) FROM bookings WHERE status = 'completed'");
        const financeRes = await pool.query(`
            SELECT 
                SUM(CASE WHEN status = 'pending' AND amount ~ '[0-9]' 
                    THEN CAST(NULLIF(REGEXP_REPLACE(amount, '[^0-9.]', '', 'g'), '') AS NUMERIC) ELSE 0 END) as escrow_pending,
                SUM(CASE WHEN status = 'completed' AND amount ~ '[0-9]' 
                    THEN CAST(NULLIF(REGEXP_REPLACE(amount, '[^0-9.]', '', 'g'), '') AS NUMERIC) * 0.99 ELSE 0 END) as funds_released,
                SUM(CASE WHEN status = 'completed' AND amount ~ '[0-9]' 
                    THEN CAST(NULLIF(REGEXP_REPLACE(amount, '[^0-9.]', '', 'g'), '') AS NUMERIC) * 0.01 ELSE 0 END) as total_welfare
            FROM bookings
            WHERE amount ~ '[0-9]'
        `);

        const finance = financeRes.rows[0] || {};
        const totalBookingsRes = await pool.query("SELECT COUNT(*) FROM bookings");

        const tradeCountsRes = await pool.query('SELECT trade, COUNT(*) as count FROM workers GROUP BY trade');
        const tradeCounts = {};
        tradeCountsRes.rows.forEach(row => {
            tradeCounts[row.trade] = parseInt(row.count);
        });

        res.json({
            registeredWorkers: parseInt(totalWorkers.rows[0].total_count) || 0,
            villagesCovered: parseInt(totalVillages.rows[0].count) || 0,
            workGroups: parseInt(totalGroups.rows[0].count) || 0,
            jobsCompleted: parseInt(completedJobsRes.rows[0].count) || 0,
            totalBookings: parseInt(totalBookingsRes.rows[0].count) || 0,
            escrowPending: parseFloat(finance.escrow_pending) || 0,
            fundsReleased: parseFloat(finance.funds_released) || 0,
            totalWelfare: parseFloat(finance.total_welfare) || 0,
            tradeCounts: tradeCounts
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Urgent Jobs Endpoints
app.get('/api/urgent-jobs', async (req, res) => {
    try {
        await pool.query("UPDATE urgent_jobs SET status = 'expired' WHERE status = 'open' AND expires_at < NOW()");
        const result = await pool.query(
            "SELECT * FROM urgent_jobs WHERE status = 'open' AND expires_at > NOW() ORDER BY created_at DESC LIMIT 10"
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/urgent-jobs', async (req, res) => {
    const { name, phone, trade, village, description } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO urgent_jobs (name, phone, trade, village, description, expires_at) 
             VALUES ($1, $2, $3, $4, $5, date_trunc('day', NOW() + INTERVAL '2 days')) RETURNING *`,
            [name, phone, trade, village, description]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/urgent-jobs/:id/claim', async (req, res) => {
    const { id } = req.params;
    const { worker_phone, worker_name } = req.body;
    try {
        const result = await pool.query(
            "UPDATE urgent_jobs SET status = 'claimed', claimed_by = $1, claimed_at = NOW() WHERE id = $2 AND status = 'open' RETURNING *",
            [worker_name || worker_phone, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Job already claimed or expired' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Submit Rating
app.post('/api/rate', async (req, res) => {
    const { worker_id, stars } = req.body;
    if (!worker_id || !stars) {
        return res.status(400).json({ error: "worker_id and stars are required" });
    }

    try {
        const currentData = await pool.query('SELECT rating, reviews_count FROM workers WHERE worker_id = $1', [worker_id]);
        if (currentData.rows.length === 0) return res.status(404).json({ error: "Worker not found" });

        const { rating, reviews_count } = currentData.rows[0];
        const newReviewsCount = (reviews_count || 0) + 1;
        const newRating = (((rating || 0) * (reviews_count || 0)) + stars) / newReviewsCount;

        const result = await pool.query(
            'UPDATE workers SET rating = $1, reviews_count = $2 WHERE worker_id = $3 RETURNING rating, reviews_count',
            [newRating, newReviewsCount, worker_id]
        );

        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Worker Status
app.post('/api/worker/status', async (req, res) => {
    let { phone, availability } = req.body;
    if (!phone || !availability) return res.status(400).json({ error: "phone and availability are required" });

    const cleanPhone = phone.trim().replace(/^(\+91|0)/, '');

    try {
        const result = await pool.query(
            "UPDATE workers SET availability = $1 WHERE phone = $2 OR phone LIKE $3 RETURNING *",
            [availability, phone, `%${cleanPhone}`]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: "Worker not found" });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Next IDs
app.get('/api/next-id', async (req, res) => {
    try {
        const indResult = await pool.query("SELECT worker_id FROM workers WHERE type = 'individual' ORDER BY id DESC LIMIT 1");
        const grpResult = await pool.query("SELECT worker_id FROM workers WHERE type = 'group' ORDER BY id DESC LIMIT 1");

        let nextInd = 1241;
        let nextGrp = 341;

        if (indResult.rows.length > 0) {
            const lastId = indResult.rows[0].worker_id;
            const parts = lastId.split('-');
            const num = parseInt(parts[parts.length - 1]);
            if (!isNaN(num)) nextInd = num + 1;
        }
        if (grpResult.rows.length > 0) {
            const lastId = grpResult.rows[0].worker_id;
            const parts = lastId.split('-');
            const num = parseInt(parts[parts.length - 1]);
            if (!isNaN(num)) nextGrp = num + 1;
        }

        res.json({ nextInd, nextGrp });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create Booking
app.post('/api/book', async (req, res) => {
    const { worker_id, customer_name, customer_phone, customer_address, service_date, amount, welfare_fee } = req.body;
    const booking_id = 'BKG-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000);
    const completion_otp = Math.floor(1000 + Math.random() * 9000).toString();

    const query = `
        INSERT INTO bookings (
            booking_id, worker_id, customer_name, customer_phone, customer_address, service_date, amount, welfare_fee, completion_otp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *;
    `;
    const values = [
        booking_id, worker_id, customer_name, customer_phone, customer_address, service_date, amount || '₹500', welfare_fee || '₹0', completion_otp
    ];

    try {
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get worker by phone
app.get('/api/workers/phone/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        const result = await pool.query('SELECT * FROM workers WHERE phone = $1', [phone]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Worker not found" });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get customer bookings
app.get('/api/user/bookings/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        const result = await pool.query('SELECT b.*, w.full_name as worker_name, w.trade as worker_trade, w.phone as worker_phone FROM bookings b LEFT JOIN workers w ON b.worker_id = w.worker_id WHERE b.customer_phone = $1 ORDER BY b.created_at DESC', [phone]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get worker bookings (jobs)
app.get('/api/worker/bookings/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        const result = await pool.query('SELECT b.* FROM bookings b JOIN workers w ON b.worker_id = w.worker_id WHERE w.phone = $1 ORDER BY b.created_at DESC', [phone]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Verify Aadhaar
app.post('/api/workers/verify', async (req, res) => {
    try {
        const { worker_id } = req.body;
        const result = await pool.query('UPDATE workers SET is_verified = true WHERE worker_id = $1 RETURNING *', [worker_id]);
        if (result.rows.length === 0) return res.status(404).json({ error: "Worker not found" });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get User Profile
app.get('/api/user-profile', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: "Phone number required" });

    try {
        const workerResult = await pool.query('SELECT * FROM workers WHERE phone = $1', [phone]);
        if (workerResult.rows.length > 0) {
            return res.json({ type: 'worker', profile: workerResult.rows[0] });
        }

        const customerResult = await pool.query('SELECT * FROM bookings WHERE customer_phone = $1 LIMIT 1', [phone]);
        if (customerResult.rows.length > 0) {
            return res.json({
                type: 'customer',
                profile: {
                    full_name: customerResult.rows[0].customer_name,
                    phone: phone,
                    village: customerResult.rows[0].customer_address.split(' - ')[0]
                }
            });
        }

        res.status(404).json({ error: "User not found" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Razorpay Order Creation
app.post('/api/payments/create-order', async (req, res) => {
    const { amount } = req.body;
    try {
        const options = {
            amount: Math.round(parseFloat(amount) * 100),
            currency: "INR",
            receipt: "receipt_" + Date.now(),
        };
        const order = await razorpay.orders.create(options);
        res.json(order);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Payment Verification
app.post('/api/payments/verify', async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(sign.toString())
        .digest("hex");

    if (razorpay_signature === expectedSign) {
        res.json({ success: true });
    } else {
        res.status(400).json({ success: false });
    }
});

app.get('/api/payments/key', (req, res) => {
    res.json({ key: process.env.RAZORPAY_KEY_ID });
});

// Admin Overview
app.get('/api/admin/overview', async (req, res) => {
    try {
        const [workers, bookings, customers, trades, villages, urgentJobs, recentBookings, dailyReg] = await Promise.all([
            pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN type='group' THEN 1 END) as groups, COUNT(CASE WHEN type='individual' THEN 1 END) as individuals, SUM(members_count) as total_members, COUNT(CASE WHEN is_verified THEN 1 END) as verified FROM workers`),
            pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN status='completed' THEN 1 END) as completed, COUNT(CASE WHEN status='pending' THEN 1 END) as pending, COUNT(CASE WHEN status='cancelled' THEN 1 END) as cancelled FROM bookings`),
            pool.query(`SELECT COUNT(DISTINCT customer_phone) as total FROM bookings`),
            pool.query(`SELECT trade, COUNT(*) as count FROM workers GROUP BY trade ORDER BY count DESC LIMIT 10`),
            pool.query(`SELECT COUNT(DISTINCT village) as total FROM workers`),
            pool.query(`SELECT COUNT(*) as total FROM urgent_jobs WHERE status='open'`),
            pool.query(`SELECT b.*, w.full_name as worker_name, w.trade as worker_trade FROM bookings b LEFT JOIN workers w ON b.worker_id = w.worker_id ORDER BY b.created_at DESC LIMIT 5`),
            pool.query(`SELECT DATE(created_at) as date, COUNT(*) as count FROM workers WHERE created_at > NOW() - INTERVAL '7 days' GROUP BY DATE(created_at) ORDER BY date`)
        ]);
        res.json({
            workers: workers.rows[0],
            bookings: bookings.rows[0],
            customers: customers.rows[0],
            trades: trades.rows,
            villages: villages.rows[0],
            urgentJobs: urgentJobs.rows[0],
            recentBookings: recentBookings.rows,
            dailyRegistrations: dailyReg.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin Workers
app.get('/api/admin/workers', async (req, res) => {
    const { search, trade, type } = req.query;
    let query = 'SELECT * FROM workers WHERE 1=1';
    const params = [];
    if (search) {
        params.push(`%${search}%`);
        query += ` AND (full_name ILIKE $${params.length} OR phone ILIKE $${params.length} OR village ILIKE $${params.length} OR worker_id ILIKE $${params.length})`;
    }
    if (trade) { params.push(trade); query += ` AND trade = $${params.length}`; }
    if (type)  { params.push(type);  query += ` AND type = $${params.length}`; }
    query += ' ORDER BY created_at DESC';
    try {
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin Bookings
app.get('/api/admin/bookings', async (req, res) => {
    const { status, search } = req.query;
    let query = `
        SELECT b.*, 
            w.full_name as worker_name, w.trade as worker_trade, 
            w.village as worker_village, w.phone as worker_phone, w.type as worker_type
        FROM bookings b
        LEFT JOIN workers w ON b.worker_id = w.worker_id
        WHERE 1=1
    `;
    const params = [];
    if (status) { params.push(status); query += ` AND b.status = $${params.length}`; }
    if (search) {
        params.push(`%${search}%`);
        query += ` AND (b.customer_name ILIKE $${params.length} OR b.customer_phone ILIKE $${params.length} OR b.booking_id ILIKE $${params.length} OR w.full_name ILIKE $${params.length})`;
    }
    query += ' ORDER BY b.created_at DESC';
    try {
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Export for Vercel
module.exports = app;
