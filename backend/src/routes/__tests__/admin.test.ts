import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import adminRouter from '../admin';
import { prisma } from '../../config/database';
import { isSmtpConfigured } from '../../services/email';

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

jest.mock('../../services/email', () => ({
  isSmtpConfigured: jest.fn(),
  sendTestEmail: jest.fn(),
  sendWelcomeEmail: jest.fn(),
  sendInvitationEmail: jest.fn(),
}));

jest.mock('../../config/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

const app = express();
app.use(express.json());
app.use('/api/admin', adminRouter);

describe('POST /api/admin/users/:id/resend-invite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isSmtpConfigured as jest.Mock).mockReturnValue(true);
  });

  it('returns 409 conflict mentioning Send Reset Link when the user has already signed in', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'user-already-signed-in',
      email: 'user@example.com',
      lastLoginAt: new Date(),
    });

    const res = await request(app).post('/api/admin/users/user-already-signed-in/resend-invite');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'Conflict',
      message: 'This account has already signed in, so there is no invitation to resend. Use Send Reset Link to email them a link to set a new password.',
    });
  });
});
