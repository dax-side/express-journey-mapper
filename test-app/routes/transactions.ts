import { Router, Request, Response, NextFunction } from 'express';
import Joi from 'joi';

const router = Router();

// ============================================================
// Middleware definitions
// ============================================================

// Auth middleware
const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: 'JWT token required' });
  }
  next();
};

const adminOnly = (req: Request, res: Response, next: NextFunction) => {
  // Check admin role
  next();
};

// Rate limiting middleware
const rateLimiter = (req: Request, res: Response, next: NextFunction) => {
  // 100 requests per 15 minutes
  next();
};

// Validation schemas
const createTransactionSchema = Joi.object({
  amount: Joi.number().required().min(100).max(10000000),
  sellerId: Joi.string().required().length(24),
  description: Joi.string().max(500),
  currency: Joi.string().valid('NGN', 'USD', 'GBP').default('NGN')
});

const updateTransactionSchema = Joi.object({
  status: Joi.string().valid('pending', 'completed', 'failed', 'refunded'),
  notes: Joi.string().max(1000)
});

// Validation middleware factory
const validate = (schema: Joi.Schema) => (req: Request, res: Response, next: NextFunction) => {
  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: 'Validation failed', details: error.details });
  }
  next();
};

// ============================================================
// Service layer (simulated)
// ============================================================

class TransactionService {
  static async createTransaction(data: unknown) {
    // Database call
    return { id: '123', ...data as object, status: 'pending', createdAt: new Date() };
  }

  static async getTransactionById(id: string) {
    return { id, amount: 5000, status: 'completed' };
  }

  static async updateTransaction(id: string, data: unknown) {
    return { id, ...data as object, updatedAt: new Date() };
  }
}

class WalletService {
  static async debitWallet(userId: string, amount: number) {
    return { success: true, newBalance: 10000 };
  }
}

class PaystackService {
  static async initializePayment(amount: number, email: string) {
    return { authorization_url: 'https://paystack.com/pay/xxx', reference: 'ref_123' };
  }

  static async verifyPayment(reference: string) {
    return { status: 'success', amount: 5000 };
  }
}

// Email service
const sendTransactionEmail = async (email: string, transactionId: string) => {
  // SendGrid call
  console.log(`Sending email to ${email} for transaction ${transactionId}`);
};

// Socket emission
const io = { emit: (event: string, data: unknown) => {} };

// ============================================================
// Routes with full middleware chains
// ============================================================

/**
 * @route GET /transactions
 * @description Get all transactions for the authenticated user
 * @access Private
 */
router.get(
  '/',
  authenticate,
  rateLimiter,
  async (req: Request, res: Response) => {
    const { page, limit, status, sortBy } = req.query;
    
    // Prisma database call
    const transactions = await (prisma as any).transaction.findMany({
      where: { userId: (req as any).user.id, status: status as string },
      skip: Number(page) * Number(limit),
      take: Number(limit),
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: transactions,
      pagination: {
        page: Number(page) || 1,
        limit: Number(limit) || 10,
        total: 100
      }
    });
  }
);

/**
 * @route GET /transactions/:id
 * @description Get a specific transaction by ID
 * @access Private
 */
router.get(
  '/:transactionId',
  authenticate,
  async (req: Request, res: Response) => {
    const { transactionId } = req.params;
    
    const transaction = await TransactionService.getTransactionById(transactionId);
    
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({
      success: true,
      data: transaction
    });
  }
);

/**
 * @route POST /transactions
 * @description Create a new transaction
 * @access Private
 */
router.post(
  '/',
  authenticate,
  rateLimiter,
  validate(createTransactionSchema),
  async (req: Request, res: Response) => {
    const { amount, sellerId, description, currency } = req.body;
    
    // Create transaction
    const transaction = await TransactionService.createTransaction({
      amount,
      sellerId,
      description,
      currency,
      buyerId: (req as any).user.id
    });

    // Debit wallet
    await WalletService.debitWallet((req as any).user.id, amount);

    // Initialize payment with Paystack
    const payment = await PaystackService.initializePayment(amount, (req as any).user.email);

    // Send email notification
    await sendTransactionEmail((req as any).user.email, transaction.id);

    // Emit socket event
    io.emit('transaction_created', { transactionId: transaction.id, userId: (req as any).user.id });

    res.status(201).json({
      success: true,
      data: transaction,
      payment: {
        authorization_url: payment.authorization_url,
        reference: payment.reference
      }
    });
  }
);

/**
 * @route PUT /transactions/:id
 * @description Update a transaction (admin only)
 * @access Admin
 */
router.put(
  '/:transactionId',
  authenticate,
  adminOnly,
  validate(updateTransactionSchema),
  async (req: Request, res: Response) => {
    const { transactionId } = req.params;
    const { status, notes } = req.body;

    const transaction = await TransactionService.updateTransaction(transactionId, { status, notes });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // If refunded, credit back to wallet
    if (status === 'refunded') {
      await WalletService.debitWallet((req as any).user.id, -(transaction as any).amount);
    }

    res.json({
      success: true,
      data: transaction,
      message: 'Transaction updated successfully'
    });
  }
);

/**
 * @route DELETE /transactions/:id
 * @description Delete a transaction (admin only)
 * @access Admin
 */
router.delete(
  '/:transactionId',
  authenticate,
  adminOnly,
  async (req: Request, res: Response) => {
    const { transactionId } = req.params;

    // Soft delete
    await (prisma as any).transaction.update({
      where: { id: transactionId },
      data: { deletedAt: new Date() }
    });

    res.status(204).send();
  }
);

/**
 * @route POST /transactions/:id/refund
 * @description Process a refund for a transaction
 * @access Admin
 */
router.post(
  '/:transactionId/refund',
  authenticate,
  adminOnly,
  rateLimiter,
  async (req: Request, res: Response) => {
    const { transactionId } = req.params;
    const { reason } = req.body;

    // Get transaction
    const transaction = await TransactionService.getTransactionById(transactionId);

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Process refund with Paystack
    // await PaystackService.refund(transaction.reference);

    // Credit wallet
    await WalletService.debitWallet((transaction as any).buyerId, -(transaction as any).amount);

    // Update transaction
    await TransactionService.updateTransaction(transactionId, { 
      status: 'refunded',
      refundReason: reason
    });

    // Send refund email
    await sendTransactionEmail((req as any).user.email, transactionId);

    res.json({
      success: true,
      message: 'Refund processed successfully',
      data: {
        transactionId,
        refundedAmount: (transaction as any).amount,
        status: 'refunded'
      }
    });
  }
);

// Fake prisma for type checking
declare const prisma: unknown;

export default router;
