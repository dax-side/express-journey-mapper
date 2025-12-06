import express from 'express';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import bookingRoutes from './routes/bookings';
import productRoutes from './routes/products';

const app = express();
app.use(express.json());

// Mount modular routers
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/products', productRoutes);  // Uses router.route() chained pattern

// Health check (inline route)
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default app;
