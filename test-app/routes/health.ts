import { Router, Request, Response, NextFunction } from 'express';
import cors from 'cors';

const router = Router();

// CORS config with string that should NOT be picked up as external call
const corsConfig = {
  origin: (origin: string, callback: Function) => {
    const allowedOrigins = ['https://example.com', 'https://app.example.com'];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Blocked CORS request from origin: ${origin}`));
    }
  },
  credentials: true
};

// Middleware that uses paystack (imported but NOT used in this handler)
import { paystack } from './services/payment-mock';

/**
 * @route GET /health
 * @description Health check endpoint
 * @access Public
 * 
 * This endpoint should have:
 * - NO external calls (cors is middleware, not an external service)
 * - NO side effects
 * - Response: { status: 'ok' }
 */
router.get(
  '/',
  cors(corsConfig as any),
  (req: Request, res: Response) => {
    // Simple health check - no external calls, no side effects
    res.json({ status: 'ok' });
  }
);

/**
 * @route GET /health/detailed
 * @description Detailed health check with actual database call
 * @access Private
 * 
 * This SHOULD show:
 * - Database call to check connection
 * - No payment calls (paystack is imported but not used here)
 */
router.get(
  '/detailed',
  async (req: Request, res: Response) => {
    // This is an actual database call - should be detected
    const dbCheck = await (global as any).prisma?.user.findFirst();
    
    res.json({ 
      status: 'ok',
      database: dbCheck ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString()
    });
  }
);

/**
 * @route POST /health/notify
 * @description Notify health status - has actual external call
 * @access Private
 * 
 * This SHOULD show:
 * - Email side effect (sendNotification)
 * - HTTP external call to external API
 * - NO payment calls
 */
router.post(
  '/notify',
  async (req: Request, res: Response) => {
    const { email } = req.body;
    
    // This is an actual external HTTP call - should be detected
    const response = await fetch('https://api.external-monitor.com/alert', {
      method: 'POST',
      body: JSON.stringify({ status: 'up', email })
    });
    
    // This is a side effect - should be detected
    await sendNotificationEmail(email, 'System is healthy');
    
    res.json({ 
      success: true,
      notified: email
    });
  }
);

// Helper functions
async function sendNotificationEmail(email: string, message: string) {
  // Email sending logic
  console.log(`Sending email to ${email}: ${message}`);
}

export default router;
