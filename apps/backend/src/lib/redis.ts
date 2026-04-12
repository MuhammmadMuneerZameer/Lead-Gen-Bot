import Redis from 'ioredis';
import { logger } from './logger';

let redisInstance: Redis | null = null;

export function getRedis(): Redis {
  if (redisInstance) return redisInstance;

  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not defined');

  redisInstance = new Redis(url, {
    lazyConnect: true,
    // NOTE: maxRetriesPerRequest must be null for BullMQ connections.
    // This singleton is used for app-level calls (cache, cost tracking).
    // BullMQ creates its own connections via getBullMQRedis().
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 500, 3000),
  });

  redisInstance.on('connect', () => logger.info('Redis connected'));
  redisInstance.on('error', (err) => logger.error('Redis error', { error: err.message }));
  redisInstance.on('close', () => logger.warn('Redis connection closed'));

  return redisInstance;
}

// Singleton exported for use across the app
export const redis = getRedis();

export function getRedisStatus(): 'ready' | 'not ready' {
  return redisInstance?.status === 'ready' ? 'ready' : 'not ready';
}
