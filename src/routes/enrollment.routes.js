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

        // Check if email already exists
        const [existingMembers] = await connection.execute(
            'SELECT id FROM Members WHERE email = ?',
            [email]
        );

        if (existingMembers.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Check batch capacity
        const [batchDetails] = await connection.execute(
            'SELECT current_capacity, max_capacity FROM GymBatches WHERE batch_time = ?',
            [batch_time]
        );

        if (!batchDetails.length) {
            return res.status(400).json({ error: 'Invalid batch time' });
        }

        if (batchDetails[0].current_capacity >= batchDetails[0].max_capacity) {
            // Get available batches
            const [availableBatches] = await connection.execute(`
                SELECT batch_time, current_capacity, max_capacity 
                FROM GymBatches 
                WHERE current_capacity < max_capacity
            `);

            return res.status(400).json({
                error: 'Selected batch is full',
                availableBatches
            });
        }

        // Insert new member
        const [memberResult] = await connection.execute(
            `INSERT INTO Members (name, email, address, phone) 
             VALUES (?, ?, ?, ?)`,
            [name, email, address || null, phone]
        );

        const memberId = memberResult.insertId;

        // Create enrollment
        const currentDate = new Date();
        const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);

        await connection.execute(
            `INSERT INTO Enrollments (member_id, batch_time, month, amount) 
             VALUES (?, ?, ?, ?)`,
            [memberId, batch_time, firstDayOfMonth, payment_amount]
        );

        // Update batch capacity
        await connection.execute(
            `UPDATE GymBatches 
             SET current_capacity = current_capacity + 1 
             WHERE batch_time = ?`,
            [batch_time]
        );

        await connection.commit();

        res.status(201).json({
            message: 'Enrollment successful',
            memberId,
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

export default router; 