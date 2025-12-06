import express, { Request, Response } from 'express';
import { getUsers, getUserById, updateUser } from '../controllers/user.controller';

const router = express.Router();

// GET /api/users
router.get('/', getUsers);

// GET /api/users/:id
router.get('/:id', getUserById);

// PUT /api/users/:id
router.put('/:id', updateUser);

export default router;
