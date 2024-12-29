import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

// Create connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'student',
    database: process.env.DB_NAME || 'gym_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Initialize database tables
async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();

        // Create Members table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS Members (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                address TEXT,
                phone VARCHAR(15) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create GymBatches table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS GymBatches (
                id INT PRIMARY KEY AUTO_INCREMENT,
                batch_time TIME NOT NULL,
                current_capacity INT DEFAULT 0,
                max_capacity INT NOT NULL,
                monthly_fee DECIMAL(10,2) NOT NULL DEFAULT 1000.00
            )
        `);

        // Create Enrollments table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS Enrollments (
                id INT PRIMARY KEY AUTO_INCREMENT,
                member_id INT,
                batch_time TIME NOT NULL,
                month DATE NOT NULL,
                payment_status ENUM('pending', 'paid') DEFAULT 'pending',
                amount DECIMAL(10,2) NOT NULL,
                batch_change_requested BOOLEAN DEFAULT FALSE,
                new_batch_time TIME DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (member_id) REFERENCES Members(id),
                UNIQUE KEY unique_member_month (member_id, month)
            )
        `);

        // Create Payments table
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS Payments (
                id INT PRIMARY KEY AUTO_INCREMENT,
                enrollment_id INT,
                amount DECIMAL(10,2) NOT NULL,
                payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                transaction_id VARCHAR(255),
                FOREIGN KEY (enrollment_id) REFERENCES Enrollments(id)
            )
        `);

        // Insert default batch times if they don't exist
        await connection.execute(`
            INSERT IGNORE INTO GymBatches (batch_time, max_capacity, monthly_fee) VALUES 
            ('06:00:00', 30, 1000.00),
            ('07:00:00', 30, 1000.00),
            ('08:00:00', 30, 1000.00),
            ('17:00:00', 30, 1000.00),
            ('18:00:00', 30, 1000.00)
        `);

        connection.release();
        console.log('Database tables initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
        throw error;
    }
}

// Initialize the database when the application starts
initializeDatabase();

// Export the pool to be used in other parts of the app
export default pool;
