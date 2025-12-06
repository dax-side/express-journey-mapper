import express from 'express';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import bookingRoutes from './routes/bookings';

const app = express();
app.use(express.json());

// Mount modular routers
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/bookings', bookingRoutes);

// Health check (inline route)
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default app;
