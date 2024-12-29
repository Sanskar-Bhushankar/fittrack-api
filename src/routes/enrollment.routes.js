import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

// Endpoint to get available batches with their current capacities
router.get('/available-batches', async (req, res) => {
    try {
        const [batches] = await pool.execute(`
            SELECT batch_time, current_capacity, max_capacity 
            FROM GymBatches 
            WHERE current_capacity < max_capacity
        `);
        res.json(batches);
    } catch (error) {
        console.error('Error fetching batches:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to enroll a new member
router.post('/enroll', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const {
            name,
            email,
            address,
            phone,
            batch_time,
            payment_amount
        } = req.body;

        // Validate required fields
        if (!name || !email || !phone || !batch_time || !payment_amount) {
            return res.status(400).json({ 
                error: 'Missing required fields',
                required: ['name', 'email', 'phone', 'batch_time', 'payment_amount']
            });
        }

        // Get batch fee and check if batch exists
        const [batchDetails] = await connection.execute(
            'SELECT monthly_fee, current_capacity, max_capacity FROM GymBatches WHERE batch_time = ?',
            [batch_time]
        );

        if (!batchDetails.length) {
            await connection.rollback();
            return res.status(400).json({ error: 'Invalid batch time' });
        }

        if (batchDetails[0].current_capacity >= batchDetails[0].max_capacity) {
            await connection.rollback();
            return res.status(400).json({ error: 'Selected batch is full' });
        }

        if (payment_amount < batchDetails[0].monthly_fee) {
            await connection.rollback();
            return res.status(400).json({ 
                error: 'Insufficient payment amount',
                required_amount: batchDetails[0].monthly_fee 
            });
        }

        // Check if email already exists
        const [existingMembers] = await connection.execute(
            'SELECT id FROM Members WHERE email = ?',
            [email]
        );

        if (existingMembers.length > 0) {
            await connection.rollback();
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Insert new member
        const [memberResult] = await connection.execute(
            'INSERT INTO Members (name, email, address, phone) VALUES (?, ?, ?, ?)',
            [name, email, address || null, phone]
        );

        const memberId = memberResult.insertId;

        // Create enrollment
        const currentDate = new Date();
        const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        
        const [enrollmentResult] = await connection.execute(
            'INSERT INTO Enrollments (member_id, batch_time, month, amount, payment_status) VALUES (?, ?, ?, ?, ?)',
            [memberId, batch_time, firstDayOfMonth, payment_amount, 'pending']
        );

        const enrollmentId = enrollmentResult.insertId;

        // Create payment record
        await connection.execute(
            'INSERT INTO Payments (enrollment_id, amount, transaction_id) VALUES (?, ?, ?)',
            [enrollmentId, payment_amount, `TXN${Date.now()}`]
        );

        // Update enrollment payment status
        await connection.execute(
            'UPDATE Enrollments SET payment_status = ? WHERE id = ?',
            ['paid', enrollmentId]
        );

        // Update batch capacity
        await connection.execute(
            'UPDATE GymBatches SET current_capacity = current_capacity + 1 WHERE batch_time = ?',
            [batch_time]
        );

        await connection.commit();

        res.status(201).json({
            message: 'Enrollment successful',
            memberId,
            enrollmentId,
            batch_time
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error in enrollment:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        connection.release();
    }
});

// New endpoint: Get unpaid fees
router.get('/unpaid', async (req, res) => {
    try {
        const [unpaidEnrollments] = await pool.execute(`
            SELECT 
                m.name, 
                m.email, 
                e.month, 
                e.amount,
                e.batch_time
            FROM Enrollments e
            JOIN Members m ON e.member_id = m.id
            WHERE e.payment_status = 'pending'
            ORDER BY e.month DESC
        `);
        res.json(unpaidEnrollments);
    } catch (error) {
        console.error('Error fetching unpaid fees:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get outstanding dues per student
router.get('/outstanding-dues', async (req, res) => {
    try {
        const [outstandingDues] = await pool.execute(`
            SELECT 
                m.name, 
                m.email, 
                COUNT(e.id) as pending_months,
                SUM(e.amount) as total_dues
            FROM Members m
            JOIN Enrollments e ON m.id = e.member_id
            WHERE e.payment_status = 'pending'
            GROUP BY m.id, m.name, m.email
        `);
        res.json(outstandingDues);
    } catch (error) {
        console.error('Error calculating dues:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Request batch change for next month
router.post('/change-batch', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { email, name, new_batch_time } = req.body;

        // First, verify the batch exists and has capacity
        const [batchDetails] = await connection.execute(
            'SELECT current_capacity, max_capacity FROM GymBatches WHERE batch_time = ?',
            [new_batch_time]
        );

        if (!batchDetails.length) {
            await connection.rollback();
            return res.status(400).json({ error: 'Invalid batch time' });
        }

        if (batchDetails[0].current_capacity >= batchDetails[0].max_capacity) {
            await connection.rollback();
            return res.status(400).json({ error: 'Selected batch is full' });
        }

        // Find member by email and name
        const [member] = await connection.execute(
            'SELECT id FROM Members WHERE email = ? AND name = ?',
            [email, name]
        );

        if (!member.length) {
            await connection.rollback();
            return res.status(404).json({ 
                error: 'Member not found. Please check your email and name.' 
            });
        }

        const member_id = member[0].id;

        // Get next month's date
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        nextMonth.setDate(1); // First day of next month

        // Format the date to match MySQL date format
        const formattedNextMonth = nextMonth.toISOString().slice(0, 10);

        // Check if already enrolled for next month
        const [existingEnrollment] = await connection.execute(
            'SELECT id, batch_time FROM Enrollments WHERE member_id = ? AND DATE(month) = ?',
            [member_id, formattedNextMonth]
        );

        // Get the monthly fee for the new batch
        const [batchFee] = await connection.execute(
            'SELECT monthly_fee FROM GymBatches WHERE batch_time = ?',
            [new_batch_time]
        );

        if (existingEnrollment.length > 0) {
            // Update existing enrollment
            await connection.execute(
                'UPDATE Enrollments SET batch_time = ?, amount = ? WHERE id = ?',
                [new_batch_time, batchFee[0].monthly_fee, existingEnrollment[0].id]
            );

            // Update batch capacities
            await connection.execute(
                'UPDATE GymBatches SET current_capacity = current_capacity - 1 WHERE batch_time = ?',
                [existingEnrollment[0].batch_time]
            );

            await connection.execute(
                'UPDATE GymBatches SET current_capacity = current_capacity + 1 WHERE batch_time = ?',
                [new_batch_time]
            );
        } else {
            // Create new enrollment for next month
            await connection.execute(
                'INSERT INTO Enrollments (member_id, batch_time, month, amount, payment_status) VALUES (?, ?, ?, ?, ?)',
                [member_id, new_batch_time, formattedNextMonth, batchFee[0].monthly_fee, 'pending']
            );

            // Update new batch capacity
            await connection.execute(
                'UPDATE GymBatches SET current_capacity = current_capacity + 1 WHERE batch_time = ?',
                [new_batch_time]
            );
        }

        await connection.commit();
        res.json({ 
            message: existingEnrollment.length > 0 
                ? 'Batch updated for next month' 
                : 'Batch change requested for next month',
            new_batch_time,
            month: formattedNextMonth
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error in batch change:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    } finally {
        connection.release();
    }
});

// Add this new endpoint
router.get('/member/:id/current-batch', async (req, res) => {
    try {
        const { id } = req.params;
        const currentDate = new Date();
        const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        
        const [enrollment] = await pool.execute(`
            SELECT 
                e.batch_time,
                e.payment_status,
                e.month,
                g.monthly_fee,
                g.current_capacity,
                g.max_capacity
            FROM Enrollments e
            JOIN GymBatches g ON e.batch_time = g.batch_time
            WHERE e.member_id = ? AND e.month = ?
        `, [id, firstDayOfMonth]);

        if (!enrollment.length) {
            return res.status(404).json({ error: 'No active enrollment found for this month' });
        }

        res.json(enrollment[0]);
    } catch (error) {
        console.error('Error fetching member batch:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router; 