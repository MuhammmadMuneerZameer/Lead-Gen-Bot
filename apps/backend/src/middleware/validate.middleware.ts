import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError, z } from 'zod';

type Target = 'body' | 'query' | 'params';

/**
 * Validates req[target] against the given Zod schema.
 * On success, assigns the parsed (coerced) value back to req[target].
 * On failure, returns 400 with structured error details.
 */
export function validate<T extends ZodSchema>(schema: T, target: Target = 'body') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const result = await schema.safeParseAsync(req[target]);
    if (!result.success) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        details: (result.error as ZodError).errors.map(e => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }
    // Write coerced/defaulted values back so downstream handlers get clean data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as unknown as Record<string, unknown>)[target] = result.data;
    next();
  };
}

/** Legacy alias used by older routers */
export const validateRequest = validate;
