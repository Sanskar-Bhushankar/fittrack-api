# Gym Registration System Database Schema

## Tables

### 1. Members
- `id` BIGINT PRIMARY KEY AUTO_INCREMENT
- `name` VARCHAR(255) NOT NULL
- `email` VARCHAR(255) UNIQUE NOT NULL
- `password` VARCHAR(255) NOT NULL
- `address` TEXT ENCRYPTED
- `phone` VARCHAR(15) NOT NULL
- `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP

### 2. GymBatches
- `id` BIGINT PRIMARY KEY AUTO_INCREMENT
- `batch_time` TIME NOT NULL  # e.g., 6:00, 7:00, 8:00
- `current_capacity` INT DEFAULT 0
- `max_capacity` INT NOT NULL

### 3. Enrollments
- `id` BIGINT PRIMARY KEY AUTO_INCREMENT
- `member_id` BIGINT
- `batch_time` TIME NOT NULL
- `month` DATE NOT NULL  # Stores first day of the month for tracking
- `payment_status` ENUM('pending', 'paid') DEFAULT 'pending'
- `amount` DECIMAL(10,2) NOT NULL
- `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
- FOREIGN KEY (`member_id`) REFERENCES `Members`(`id`)
- UNIQUE KEY `unique_member_month` (`member_id`, `month`)

### 4. Payments
- `id` BIGINT PRIMARY KEY AUTO_INCREMENT
- `enrollment_id` BIGINT
- `amount` DECIMAL(10,2) NOT NULL
- `payment_date` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
- `transaction_id` VARCHAR(255)
- FOREIGN KEY (`enrollment_id`) REFERENCES `Enrollments`(`id`) 