import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.middleware';
import { authenticate, generateTokens, verifyRefreshToken } from '../../middleware/auth.middleware';
import { authLimiter, registerLimiter } from '../../middleware/rateLimit.middleware';
import { User, hashPassword } from '../../models/user.model';
import { logger } from '../../lib/logger';

const router = Router();

// ── Schemas ─────────────────────────────────────────────────────────────────

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// ── POST /api/auth/register ─────────────────────────────────────────────────

router.post('/register', registerLimiter, validate(RegisterSchema), async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body as z.infer<typeof RegisterSchema>;

    const exists = await User.findOne({ email }).lean();
    if (exists) {
      res.status(409).json({ error: 'EMAIL_TAKEN', message: 'Email already registered' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const user = await User.create({ email, passwordHash, name });

    const tokens = generateTokens(String(user._id));
    logger.info('User registered', { userId: String(user._id), email });

    res.status(201).json({
      user: { id: user._id, email: user.email, name: user.name, role: user.role },
      ...tokens,
    });
  } catch (err) {
    logger.error('POST /auth/register error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/auth/login ────────────────────────────────────────────────────

router.post('/login', authLimiter, validate(LoginSchema), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as z.infer<typeof LoginSchema>;

    const user = await User.findOne({ email, active: true }).select('+passwordHash');
    if (!user) {
      res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      return;
    }

    const valid = await user.comparePassword(password);
    if (!valid) {
      res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      return;
    }

    user.lastLoginAt = new Date();
    await user.save();

    const tokens = generateTokens(String(user._id));
    logger.info('User logged in', { userId: String(user._id), email });

    res.json({
      user: { id: user._id, email: user.email, name: user.name, role: user.role },
      ...tokens,
    });
  } catch (err) {
    logger.error('POST /auth/login error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── POST /api/auth/refresh ──────────────────────────────────────────────────

router.post('/refresh', validate(RefreshSchema), async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body as z.infer<typeof RefreshSchema>;

    let payload: { userId: string };
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      res.status(401).json({ error: 'INVALID_REFRESH_TOKEN' });
      return;
    }

    const user = await User.findById(payload.userId).lean();
    if (!user || !user.active) {
      res.status(401).json({ error: 'USER_NOT_FOUND' });
      return;
    }

    const tokens = generateTokens(payload.userId);
    res.json(tokens);
  } catch (err) {
    logger.error('POST /auth/refresh error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/auth/me ────────────────────────────────────────────────────────

router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.user?.userId).lean();
    if (!user) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    res.json({ id: user._id, email: user.email, name: user.name, role: user.role });
  } catch (err) {
    logger.error('GET /auth/me error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
