import { Request, Response } from 'express';

export const getUsers = async (req: Request, res: Response) => {
  const { limit, offset } = req.query;
  
  // Simulate database query
  const users = [
    { id: 1, name: 'John Doe', email: 'john@example.com' },
    { id: 2, name: 'Jane Smith', email: 'jane@example.com' }
  ];

  res.json({
    users,
    total: 2,
    limit: limit || 10,
    offset: offset || 0
  });
};

export const getUserById = async (req: Request, res: Response) => {
  const { id } = req.params;

  // Simulate database lookup
  const user = { id, name: 'John Doe', email: 'john@example.com' };

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json(user);
};

export const updateUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, email } = req.body;

  // Simulate database update
  const updatedUser = { id, name, email };

  res.json({
    message: 'User updated successfully',
    user: updatedUser
  });
};
