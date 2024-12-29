import express from 'express';
import './config/db.js'; // Import db.js to execute the database setup and connection
import enrollmentRoutes from './routes/enrollment.routes.js';

const app = express();

// Middleware for parsing JSON bodies
app.use(express.json());

// Use enrollment routes
app.use('/api/enrollment', enrollmentRoutes);

// Sample route
app.get('/', (req, res) => {
  res.send('Hello, World!');
});

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

