import express from 'express';
import cors from 'cors';
import './config/db.js'; // Import db.js to execute the database setup and connection
import enrollmentRoutes from './routes/enrollment.routes.js';

const app = express();

// Enable CORS - more permissive for development
app.use(cors());  // Allow all origins in development

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

