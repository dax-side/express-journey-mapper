import { Router, Request, Response } from 'express';

const router = Router();

// Test the chained route pattern - this was broken before v1.0.5
router.route('/')
  .get((req: Request, res: Response) => {
    res.json({ products: [] });
  })
  .post((req: Request, res: Response) => {
    const { name, price } = req.body;
    res.status(201).json({ id: 1, name, price });
  });

router.route('/:id')
  .get((req: Request, res: Response) => {
    res.json({ id: req.params.id, name: 'Product', price: 99.99 });
  })
  .put((req: Request, res: Response) => {
    res.json({ message: 'Product updated' });
  })
  .delete((req: Request, res: Response) => {
    res.status(204).send();
  });

// Mixed pattern: direct method + chained in same file
router.get('/featured', (req: Request, res: Response) => {
  res.json({ featured: [] });
});

// Chained with middleware
router.route('/admin')
  .all((req: Request, res: Response, next) => {
    // Admin auth middleware
    next();
  })
  .get((req: Request, res: Response) => {
    res.json({ adminProducts: [] });
  })
  .post((req: Request, res: Response) => {
    res.status(201).json({ created: true });
  });

export default router;
