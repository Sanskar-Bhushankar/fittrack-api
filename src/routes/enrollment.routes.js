import express from 'express';
import pool from '../config/db.js';

const router = express.Router();

// Endpoint to get available batches with their current capacities
router.get('/available-batches', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const [batches] = await connection.execute(
            'SELECT * FROM GymBatches'
        );
        res.json(batches);
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).json({ 
            message: 'Error fetching batches',
            error: error.message 
        });
    } finally {
        connection.release();
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
            payment_amount,
            payment_status
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

        // Create enrollment with the correct payment status
        const currentDate = new Date();
        const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        
        const [enrollmentResult] = await connection.execute(
            'INSERT INTO Enrollments (member_id, batch_time, month, amount, payment_status) VALUES (?, ?, ?, ?, ?)',
            [memberId, batch_time, firstDayOfMonth, payment_amount, payment_status]
        );

        const enrollmentId = enrollmentResult.insertId;

        // Only create payment record and update status if payment is made now
        if (payment_status === 'paid') {
            await connection.execute(
                'INSERT INTO Payments (enrollment_id, amount, transaction_id) VALUES (?, ?, ?)',
                [enrollmentId, payment_amount, `TXN${Date.now()}`]
            );
        }

        // Don't update the payment status again - keep it as set during enrollment
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
        const [enrollments] = await pool.execute(`
            SELECT 
                m.name, 
                m.email, 
                e.batch_time,
                e.amount,
                e.payment_status,
                e.month,
                g.monthly_fee
            FROM Enrollments e
            JOIN Members m ON e.member_id = m.id
            JOIN GymBatches g ON e.batch_time = g.batch_time
            ORDER BY e.month DESC
        `);
        res.json(enrollments);
    } catch (error) {
        console.error('Error fetching enrollments:', error);
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

        // Get current month's enrollment
        const currentDate = new Date();
        const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        
        // Update the existing enrollment for the current month
        const [updateResult] = await connection.execute(
            `UPDATE Enrollments 
             SET batch_change_requested = true, 
                 new_batch_time = ? 
             WHERE member_id = ? 
             AND month = ?`,
            [new_batch_time, member_id, firstDayOfMonth]
        );

        if (updateResult.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ 
                error: 'No active enrollment found for current month' 
            });
        }

        await connection.commit();
        res.json({ 
            message: 'Batch change requested for next month',
            new_batch_time
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

// Add this new endpoint to get batch change requests
router.get('/batch-change-requests', async (req, res) => {
    try {
        const [requests] = await pool.execute(`
            SELECT 
                m.name, 
                m.email, 
                e.batch_time as current_batch_time,
                e.new_batch_time,
                e.batch_change_requested,
                e.month
            FROM Enrollments e
            JOIN Members m ON e.member_id = m.id
            WHERE e.batch_change_requested = true
            ORDER BY e.month DESC
        `);
        res.json(requests);
    } catch (error) {
        console.error('Error fetching batch change requests:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add a test route to verify API is working
router.get('/test', (req, res) => {
  res.json({ message: 'API is working' });
});

export default router; 