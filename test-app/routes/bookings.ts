import express, { Request, Response } from 'express';

const router = express.Router();

// GET /api/bookings
router.get('/', (req: Request, res: Response) => {
  res.json([
    { id: 1, date: '2025-01-01', status: 'confirmed' },
    { id: 2, date: '2025-01-15', status: 'pending' }
  ]);
});

// POST /api/bookings
router.post('/', async (req: Request, res: Response) => {
  const { date, serviceId } = req.body;
  
  // Simulate database call
  const booking = { id: Date.now(), date, serviceId, status: 'pending' };
  
  res.status(201).json({
    message: 'Booking created',
    booking
  });
});

// GET /api/bookings/:id
router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  res.json({ id, date: '2025-01-01', status: 'confirmed' });
});

// DELETE /api/bookings/:id
router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  res.json({ message: `Booking ${id} cancelled` });
});

export default router;
