import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../lib/logger';
import { User } from '../models/user.model';

export interface JWTPayload {
  userId: string;
  role?: string;
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or malformed token' });
    return;
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    logger.error('JWT_SECRET not configured');
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Auth misconfiguration' });
    return;
  }

  try {
    const payload = jwt.verify(token, secret) as JWTPayload;
    req.user = payload;
    next();
  } catch (err) {
    const message = err instanceof jwt.TokenExpiredError ? 'Token expired' : 'Invalid token';
    res.status(401).json({ error: 'UNAUTHORIZED', message });
  }
}

export function generateTokens(userId: string): { accessToken: string; refreshToken: string } {
  const secret = process.env.JWT_SECRET!;
  const refreshSecret = process.env.JWT_REFRESH_SECRET!;

  const accessToken = jwt.sign({ userId }, secret, { expiresIn: '15m' });
  const refreshToken = jwt.sign({ userId }, refreshSecret, { expiresIn: '7d' });

  return { accessToken, refreshToken };
}

export function verifyRefreshToken(token: string): JWTPayload {
  const secret = process.env.JWT_REFRESH_SECRET!;
  return jwt.verify(token, secret) as JWTPayload;
}

export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user?.userId) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    const user = await User.findById(req.user.userId).select('role').lean();
    if (!user || !roles.includes(user.role as string)) {
      res.status(403).json({ error: 'FORBIDDEN', message: `Requires role: ${roles.join(' or ')}` });
      return;
    }
    next();
  };
}
