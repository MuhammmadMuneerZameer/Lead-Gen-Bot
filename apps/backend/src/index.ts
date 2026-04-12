import 'dotenv-safe/config';
import express from 'express';
import cors from 'cors';
import { connectDB } from './lib/db';
import { redis } from './lib/redis';
import { logger } from './lib/logger';
import { apiLimiter } from './middleware/rateLimit.middleware';
import authRouter from './api/routers/auth.router';
import usersRouter from './api/routers/users.router';
import campaignsRouter from './api/routers/campaigns.router';
import leadsRouter from './api/routers/leads.router';
import jobsRouter from './api/routers/jobs.router';
import analyticsRouter from './api/routers/analytics.router';
import settingsRouter from './api/routers/settings.router';
import { startWorkers } from './workers';
import { runSeed } from './seed';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:3000' }));
app.use(express.json({ limit: '1mb' }));
app.use(apiLimiter);

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/leads', leadsRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/settings', settingsRouter);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    db: 'connected',
    redis: redis.status,
    uptime: Math.floor(process.uptime()),
  });
});

// ── 404 handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'NOT_FOUND' });
});

// ── Global error handler ─────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { message: err.message, stack: err.stack });
  res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
});

async function start(): Promise<void> {
  logger.info('HydraFox Lead Engine v3.0 starting...');

  // 1. Connect to MongoDB — must succeed before accepting traffic
  await connectDB();
  logger.info('MongoDB connected');

  // 2. Verify Redis is reachable
  await redis.ping();
  logger.info('Redis connected');

  // 3. Seed initial data (idempotent — skips if already seeded)
  await runSeed();

  // 4. Start BullMQ workers
  startWorkers();
  logger.info('BullMQ workers started');

  // 4. Start HTTP server
  app.listen(PORT, () => {
    logger.info(`API server listening on :${PORT}`);
  });
}

start().catch((err: Error) => {
  logger.error('Fatal startup error', { message: err.message, stack: err.stack });
  process.exit(1);
});

// ── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down');
  await redis.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received — shutting down');
  await redis.quit();
  process.exit(0);
});
