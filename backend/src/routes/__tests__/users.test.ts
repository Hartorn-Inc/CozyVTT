import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import usersRouter from '../users';

jest.mock('../../middleware/auth', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.session = {
      userId: 'admin-1',
      platformRole: 'ADMIN',
    } as unknown as Request['session'];
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

jest.mock('../../middleware/authLimiters', () => ({
  passwordCheckLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  accountLoginLimiter: {
    recordFailure: jest.fn(),
    forget: jest.fn(),
  },
  accountLoginKey: jest.fn(),
}));

const app = express();
app.use(express.json());
app.use('/api/users', usersRouter);

describe('POST /api/users/:id/reset-password', () => {
  it('returns 400 mentioning Change Password when an admin attempts to reset their own password', async () => {
    const res = await request(app).post('/api/users/admin-1/reset-password');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Bad Request',
      message: 'You cannot reset your own password from here. Use Change Password on your profile, which asks for your current password.',
    });
  });
});
