import { Request, Response } from 'express';
import axios from 'axios';

export const register = async (req: Request, res: Response) => {
  const { email, password, name } = req.body;

  // Simulate external API call for email verification
  try {
    await axios.post('https://api.email-service.com/verify', { email });
  } catch (error) {
    // Handle error
  }

  // Simulate database insert
  const user = { id: 123, email, name };

  res.status(201).json({
    message: 'Account created successfully',
    user,
    token: 'jwt-token-here'
  });
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return;
  }

  // Simulate database lookup
  const user = { id: 123, email };

  res.json({
    message: 'Login successful',
    user,
    token: 'jwt-token-here'
  });
};
