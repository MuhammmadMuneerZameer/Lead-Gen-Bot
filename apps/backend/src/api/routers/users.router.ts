import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { isValidObjectId } from 'mongoose';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { validate } from '../../middleware/validate.middleware';
import { User, hashPassword } from '../../models/user.model';
import { logger } from '../../lib/logger';

const router = Router();

const UpdateUserSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  role: z.enum(['admin', 'operator', 'viewer']).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(128).optional(),
});

// ── GET /api/users ────────────────────────────────────────────────────────────

router.get('/', authenticate, requireRole('admin'), async (_req: Request, res: Response) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).lean();
    res.json({ data: users.map(u => ({ ...u, passwordHash: undefined })) });
  } catch (err) {
    logger.error('GET /users error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── GET /api/users/:id ────────────────────────────────────────────────────────

router.get('/:id', authenticate, async (req: Request, res: Response) => {
  try {
    // Users can only view their own profile; admins can view any
    const isOwnProfile = req.params.id === req.user?.userId;
    const requestingUser = await User.findById(req.user?.userId).select('role').lean();
    const isAdmin = requestingUser?.role === 'admin';
    if (!isOwnProfile && !isAdmin) {
      res.status(403).json({ error: 'FORBIDDEN' });
      return;
    }
    if (!isValidObjectId(req.params.id)) {
      res.status(400).json({ error: 'INVALID_ID' });
      return;
    }
    const user = await User.findById(req.params.id).lean();
    if (!user) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const { passwordHash: _, ...safe } = user as typeof user & { passwordHash?: string };
    res.json(safe);
  } catch (err) {
    logger.error('GET /users/:id error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── PATCH /api/users/:id ──────────────────────────────────────────────────────

router.patch('/:id', authenticate, validate(UpdateUserSchema), async (req: Request, res: Response) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      res.status(400).json({ error: 'INVALID_ID' });
      return;
    }
    const isOwnProfile = req.params.id === req.user?.userId;
    const requestingUser = await User.findById(req.user?.userId).select('role').lean();
    const isAdmin = requestingUser?.role === 'admin';

    if (!isOwnProfile && !isAdmin) {
      res.status(403).json({ error: 'FORBIDDEN' });
      return;
    }

    const { password, role, active, ...safeRest } = req.body as z.infer<typeof UpdateUserSchema>;

    // Non-admins cannot change role or active status
    if (!isAdmin && (role !== undefined || active !== undefined)) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Cannot modify role or active status' });
      return;
    }

    const update: Record<string, unknown> = {
      ...safeRest,
      ...(isAdmin && role !== undefined ? { role } : {}),
      ...(isAdmin && active !== undefined ? { active } : {}),
    };

    if (password) {
      update.passwordHash = await hashPassword(password);
    }

    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
    if (!user) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const { passwordHash: _, ...safe } = user as typeof user & { passwordHash?: string };
    res.json(safe);
  } catch (err) {
    logger.error('PATCH /users/:id error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// ── DELETE /api/users/:id — deactivate (soft delete) ─────────────────────────

router.delete('/:id', authenticate, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    if (req.params.id === req.user?.userId) {
      res.status(400).json({ error: 'CANNOT_DEACTIVATE_SELF' });
      return;
    }
    const user = await User.findByIdAndUpdate(req.params.id, { active: false }, { new: true }).lean();
    if (!user) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    res.json({ deactivated: true });
  } catch (err) {
    logger.error('DELETE /users/:id error', { error: (err as Error).message });
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

export default router;
