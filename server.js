require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Request Logging
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

// Postgres Pool Setup
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/gramaseva',
});

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Database Initialization
const initDb = async () => {
    // 1. First, try to create the database if it doesn't exist
    const adminPool = new Pool({
        connectionString: (process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/gramaseva').replace('/gramaseva', '/postgres'),
    });

    try {
        await adminPool.query('CREATE DATABASE gramaseva');
        console.log("✨ Created database 'gramaseva'");
    } catch (err) {
        // Ignore error if database already exists (code 42P04)
        if (err.code !== '42P04') {
            console.log("Note: Database 'gramaseva' check complete.");
        }
    } finally {
        await adminPool.end();
    }

    // 2. Now initialize the table
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
    `;
    try {
        await pool.query(query);
        // Safely add new columns if they don't exist
        try {
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
                ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
            `);
        } catch (e) { console.error("Error altering workers table:", e.message); }
        try {
            await pool.query(`
                ALTER TABLE bookings 
                ADD COLUMN IF NOT EXISTS welfare_fee TEXT,
                ADD COLUMN IF NOT EXISTS job_completed_at TIMESTAMP,
                ADD COLUMN IF NOT EXISTS completion_otp TEXT,
                ADD COLUMN IF NOT EXISTS is_escrow_released BOOLEAN DEFAULT FALSE,
                ALTER COLUMN amount TYPE TEXT;
            `);
            // NEW: Fill in missing OTPs for old bookings
            await pool.query("UPDATE bookings SET completion_otp = floor(random()*9000 + 1000)::text WHERE completion_otp IS NULL");
        } catch (e) { /* ignore if already formatted */ }

        console.log("✅ Database initialized (Workers & Bookings tables ready)");
    } catch (err) {
        console.error("❌ Error initializing database:", err.message);
        console.log("Tip: Please check your .env file and ensure PostgreSQL is running with the correct password.");
    }
};

initDb();

// API Endpoints

// 1. Get all workers with optional filtering
app.get('/api/workers', async (req, res) => {
    const { trade, village, search } = req.query;
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

    query += ' ORDER BY created_at DESC';

    try {
        const result = await pool.query(query, params);
        res.json(result.rows);
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
            account_type, account_no, ifsc_code, bank_name, account_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
        RETURNING *;
    `;
    const {
        worker_id, full_name, phone, trade, village, mandal,
        landmark, experience, availability, details, type,
        leader_name, members_count, price_1, price_2, price_3,
        working_hours, group_members, aadhaar_no, eshram_uan,
        account_type, account_no, ifsc_code, bank_name, account_name
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
                    account_type, account_no, ifsc_code, bank_name, account_name
                ]);
                success = true;
            } catch (err) {
                if (err.code === '23505') { // Unique constraint violation
                    console.log(`⚠️ ID Collision for ${final_worker_id}, retrying...`);
                    // Fetch latest ID and increment
                    const lastResult = await pool.query("SELECT worker_id FROM workers WHERE type = $1 ORDER BY id DESC LIMIT 1", [type]);
                    let nextNum = (type === 'group' ? 341 : 1241);
                    if (lastResult.rows.length > 0) {
                        const num = parseInt(lastResult.rows[0].worker_id.split('-').pop());
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
        console.error("❌ Registration Error:", err.message);
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
        console.error("❌ Update Bank Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// 3. Get Stats
app.get('/api/stats', async (req, res) => {
    try {
        const totalWorkers = await pool.query('SELECT SUM(members_count) as total_count FROM workers');
        const rawRows = await pool.query('SELECT COUNT(*) FROM workers');
        const totalVillages = await pool.query('SELECT COUNT(DISTINCT village) FROM workers');
        const totalGroups = await pool.query("SELECT COUNT(*) FROM workers WHERE type = 'group'");

        const registeredCount = parseInt(totalWorkers.rows[0].total_count) || 0;

        const completedJobsRes = await pool.query("SELECT COUNT(*) FROM bookings WHERE status = 'completed'");
        const jobsCompleted = parseInt(completedJobsRes.rows[0].count) || 0;

        // Calculate finances from bookings
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

        const finance = financeRes.rows[0];

        const totalBookingsRes = await pool.query("SELECT COUNT(*) FROM bookings");
        const totalBookings = parseInt(totalBookingsRes.rows[0].count) || 0;

        res.json({
            registeredWorkers: registeredCount,
            villagesCovered: parseInt(totalVillages.rows[0].count) || 0,
            workGroups: parseInt(totalGroups.rows[0].count) || 0,
            jobsCompleted: jobsCompleted,
            totalBookings: totalBookings,
            escrowPending: parseFloat(finance.escrow_pending) || 0,
            fundsReleased: parseFloat(finance.funds_released) || 0,
            totalWelfare: parseFloat(finance.total_welfare) || 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3b. Urgent Jobs Endpoints
app.get('/api/urgent-jobs', async (req, res) => {
    try {
        // Auto-expire old jobs first
        await pool.query("UPDATE urgent_jobs SET status = 'expired' WHERE status = 'open' AND expires_at < NOW()");
        // Return only open jobs (not claimed or expired)
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
        // "Valid for 2 days" -> expires at the end of the next day (midnight)
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

// 3c. Claim / Close an Urgent Job
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

app.post('/api/urgent-jobs/:id/close', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            "UPDATE urgent_jobs SET status = 'closed' WHERE id = $1 RETURNING *",
            [id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Submit Rating
app.post('/api/rate', async (req, res) => {
    const { worker_id, stars } = req.body;
    if (!worker_id || !stars) {
        return res.status(400).json({ error: "worker_id and stars are required" });
    }

    try {
        // Get current rating and count
        const currentData = await pool.query('SELECT rating, reviews_count FROM workers WHERE worker_id = $1', [worker_id]);
        if (currentData.rows.length === 0) {
            return res.status(404).json({ error: "Worker not found" });
        }

        const { rating, reviews_count } = currentData.rows[0];
        const newReviewsCount = (reviews_count || 0) + 1;
        const newRating = (((rating || 0) * (reviews_count || 0)) + stars) / newReviewsCount;

        const result = await pool.query(
            'UPDATE workers SET rating = $1, reviews_count = $2 WHERE worker_id = $3 RETURNING rating, reviews_count',
            [newRating, newReviewsCount, worker_id]
        );

        res.json(result.rows[0]);
    } catch (err) {
        console.error("❌ Rating Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// 5. Update Worker Status (Availability)
app.post('/api/worker/status', async (req, res) => {
    let { phone, availability } = req.body;
    if (!phone || !availability) {
        return res.status(400).json({ error: "phone and availability are required" });
    }

    // Clean phone number for matching
    const cleanPhone = phone.trim().replace(/^(\+91|0)/, '');
    console.log(`🔄 Updating status for phone: ${cleanPhone} to ${availability}`);

    try {
        // Try matching exactly, OR matching without prefix
        const result = await pool.query(
            "UPDATE workers SET availability = $1 WHERE phone = $2 OR phone LIKE $3 RETURNING *",
            [availability, phone, `%${cleanPhone}`]
        );

        if (result.rows.length === 0) {
            console.log(`⚠️ Worker not found for phone: ${phone}`);
            return res.status(404).json({ error: "Worker not found" });
        }
        console.log(`✅ Status updated for ${result.rows[0].full_name}`);
        res.json(result.rows[0]);
    } catch (err) {
        console.error("❌ Status Update Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// 6. Get Next IDs
app.get('/api/next-id', async (req, res) => {
    try {
        const indResult = await pool.query("SELECT worker_id FROM workers WHERE type = 'individual' ORDER BY id DESC LIMIT 1");
        const grpResult = await pool.query("SELECT worker_id FROM workers WHERE type = 'group' ORDER BY id DESC LIMIT 1");

        let nextInd = 1241;
        let nextGrp = 341;

        if (indResult.rows.length > 0) {
            const lastId = indResult.rows[0].worker_id;
            const num = parseInt(lastId.split('-').pop());
            if (!isNaN(num)) nextInd = num + 1;
        }
        if (grpResult.rows.length > 0) {
            const lastId = grpResult.rows[0].worker_id;
            const num = parseInt(lastId.split('-').pop());
            if (!isNaN(num)) nextGrp = num + 1;
        }

        res.json({ nextInd, nextGrp });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Create Booking
app.post('/api/book', async (req, res) => {
    const { worker_id, customer_name, customer_phone, customer_address, service_date, amount } = req.body;

    // Generate a simple booking ID and 4-digit Completion OTP
    const booking_id = 'BKG-' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 1000);
    const completion_otp = Math.floor(1000 + Math.random() * 9000).toString();

    const query = `
        INSERT INTO bookings (
            booking_id, worker_id, customer_name, customer_phone, customer_address, service_date, amount, welfare_fee, completion_otp
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *;
    `;
    const welfare_fee = req.body.welfare_fee || '₹0';
    const values = [
        booking_id, worker_id, customer_name, customer_phone, customer_address, service_date, amount || '₹500', welfare_fee, completion_otp
    ];

    try {
        const result = await pool.query(query, values);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error("❌ Booking Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// 7. Get Customer Bookings (Dashboard)
app.get('/api/user/bookings/:phone', async (req, res) => {
    const { phone } = req.params;
    const query = `
        SELECT b.*, 
            w.full_name as worker_name, w.trade as worker_trade, w.type as worker_type, 
            w.leader_name, w.group_members, w.phone as worker_phone, 
            w.village as worker_village, w.mandal as worker_mandal, w.landmark as worker_landmark,
            w.experience as worker_experience, w.availability as worker_availability, 
            w.details as worker_details, w.working_hours as worker_working_hours, 
            w.rating as worker_rating
        FROM bookings b
        JOIN workers w ON b.worker_id = w.worker_id
        WHERE b.customer_phone = $1
        ORDER BY b.created_at DESC;
    `;

    try {
        const result = await pool.query(query, [phone]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 8. Get Worker Incoming Bookings (Dashboard)
app.get('/api/worker/bookings/:phone', async (req, res) => {
    const { phone } = req.params;
    const query = `
        SELECT b.*, 
            w.full_name as worker_name, w.trade as worker_trade, w.type as worker_type, 
            w.leader_name, w.group_members, w.phone as worker_phone, 
            w.village as worker_village, w.mandal as worker_mandal, w.landmark as worker_landmark,
            w.experience as worker_experience, w.availability as worker_availability, 
            w.details as worker_details, w.working_hours as worker_working_hours, 
            w.rating as worker_rating
        FROM bookings b
        JOIN workers w ON b.worker_id = w.worker_id
        WHERE w.phone = $1
        ORDER BY b.created_at DESC;
    `;

    try {
        const result = await pool.query(query, [phone]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 9. Get Single Worker Detail
app.get('/api/workers/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Worker not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 11. OTP System (Fast2SMS Integration)
app.post('/api/otp/send', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: "Phone number required" });

    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    try {
        await pool.query("DELETE FROM otp_verifications WHERE phone = $1", [phone]);
        await pool.query("INSERT INTO otp_verifications (phone, otp) VALUES ($1, $2)", [phone, otp]);

        const apiKey = process.env.FAST2SMS_API_KEY;
        if (!apiKey) {
            console.log("MOCK OTP (Set FAST2SMS_API_KEY in .env):", otp);
            return res.json({ success: true, message: "OTP Simulated (Check Server Logs)" });
        }

        const url = `https://www.fast2sms.com/dev/bulkV2?authorization=${apiKey}&route=v3&sender_id=TXTIND&message=${encodeURIComponent("Your GramaSeva Login OTP is: " + otp)}&language=english&flash=0&numbers=${phone}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.return) {
            res.json({ success: true, message: "OTP sent successfully via SMS" });
        } else {
            console.error("Fast2SMS Error:", data);
            res.status(500).json({ error: data.message || "Failed to send SMS via Fast2SMS" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/otp/verify', async (req, res) => {
    const { phone, otp } = req.body;
    try {
        const result = await pool.query("SELECT * FROM otp_verifications WHERE phone = $1 AND otp = $2", [phone, otp]);
        if (result.rows.length > 0) {
            await pool.query("DELETE FROM otp_verifications WHERE phone = $1", [phone]);
            res.json({ success: true });
        } else {
            res.status(400).json({ error: "Invalid OTP. Please try again." });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 12. Complete Job (OTP Verified Escrow Release)
app.post('/api/bookings/complete', async (req, res) => {
    const { booking_id, otp } = req.body;
    try {
        // Verify OTP first
        const check = await pool.query("SELECT completion_otp FROM bookings WHERE booking_id = $1", [booking_id]);
        if (check.rows.length === 0) return res.status(404).json({ error: "Booking not found" });

        if (check.rows[0].completion_otp !== otp) {
            return res.status(400).json({ error: "Invalid Completion OTP. Please ask the customer for the correct code." });
        }

        const result = await pool.query(
            "UPDATE bookings SET status = 'completed', job_completed_at = CURRENT_TIMESTAMP, is_escrow_released = TRUE WHERE booking_id = $1 RETURNING *",
            [booking_id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 12. Verify Worker (Aadhaar KYC + Image Storage)
app.post('/api/workers/verify', async (req, res) => {
    const { worker_id, aadhaar_no, aadhaar_image } = req.body;
    try {
        const result = await pool.query(
            "UPDATE workers SET is_verified = TRUE, aadhaar_no = $2, aadhaar_image = $3 WHERE worker_id = $1 RETURNING *",
            [worker_id, aadhaar_no, aadhaar_image]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Worker not found" });
        res.json({ success: true, worker: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 12. Get Worker by Phone (Login/Dashboard)
app.get('/api/workers/phone/:phone', async (req, res) => {
    const { phone } = req.params;
    try {
        const result = await pool.query('SELECT * FROM workers WHERE phone = $1', [phone]);
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ error: 'Worker not found' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// NEW: Consolidated User Profile Endpoint (Detects if Worker or Customer)
app.get('/api/user-profile', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: "Phone number required" });

    try {
        // 1. Check if they are a Worker
        const workerResult = await pool.query('SELECT * FROM workers WHERE phone = $1', [phone]);
        if (workerResult.rows.length > 0) {
            return res.json({ type: 'worker', profile: workerResult.rows[0] });
        }

        // 2. Check if they are a Customer (have bookings)
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

        // 3. Not found
        res.status(404).json({ error: "User not found. Please register first." });
    } catch (err) {
        console.error("Profile Fetch Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// 13. Create Razorpay Order
app.post('/api/payments/create-order', async (req, res) => {
    const { amount } = req.body; // Amount in INR (e.g., 500)
    try {
        const options = {
            amount: Math.round(parseFloat(amount) * 100), // convert to paise
            currency: "INR",
            receipt: "receipt_" + Date.now(),
        };
        const order = await razorpay.orders.create(options);
        res.json(order);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 14. Verify Payment Signature
app.post('/api/payments/verify', async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSign = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(sign.toString())
        .digest("hex");

    if (razorpay_signature === expectedSign) {
        res.json({ success: true, message: "Payment verified successfully" });
    } else {
        res.status(400).json({ success: false, message: "Invalid signature" });
    }
});

// 15. Get Razorpay Key (Public)
app.get('/api/payments/key', (req, res) => {
    res.json({ key: process.env.RAZORPAY_KEY_ID });
});

// ─── ADMIN DASHBOARD ENDPOINTS ─────────────────────────────────────────────

// ADMIN: Get all registered workers (full data)
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

// ADMIN: Get all bookings with worker + customer details
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

// ADMIN: Get all unique customers (from bookings)
app.get('/api/admin/customers', async (req, res) => {
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
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADMIN: Full overview stats
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADMIN: Verify/Unverify a worker
app.post('/api/admin/workers/:id/toggle-verify', async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE workers SET is_verified = NOT is_verified WHERE worker_id = $1 RETURNING worker_id, full_name, is_verified',
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Worker not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADMIN: Delete a worker
app.delete('/api/admin/workers/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM workers WHERE worker_id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ADMIN: Update booking status
app.patch('/api/admin/bookings/:id/status', async (req, res) => {
    const { status } = req.body;
    try {
        const result = await pool.query(
            'UPDATE bookings SET status = $1 WHERE booking_id = $2 RETURNING *',
            [status, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
