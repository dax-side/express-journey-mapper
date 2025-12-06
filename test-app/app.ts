import express, { Request, Response } from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

// Authentication routes
app.post('/api/auth/register', async (req: Request, res: Response) => {
  const { email, password, name } = req.body;

  // Simulate external API call
  try {
    await axios.post('https://api.email-service.com/send-verification', {
      email,
      subject: 'Verify your account'
    });
  } catch (error) {
    // Handle error
  }

  res.status(201).json({
    message: 'Account created successfully',
    userId: '123'
  });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (email && password) {
    res.json({
      token: 'jwt-token-here',
      user: { id: 123, email }
    });
  } else {
    res.status(400).json({
      error: 'Invalid credentials'
    });
  }
});

// User routes
app.get('/api/users/profile', (req: Request, res: Response) => {
  // Assume user is authenticated
  res.json({
    id: 123,
    name: 'John Doe',
    email: 'john@example.com'
  });
});

app.put('/api/users/profile', (req: Request, res: Response) => {
  const { name, email } = req.body;
  res.json({
    message: 'Profile updated',
    user: { id: 123, name, email }
  });
});

export default app;