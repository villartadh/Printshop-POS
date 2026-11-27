import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

export function requirePlainObject(
  value: unknown,
  label = 'Request body',
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${label} must be a valid JSON object.`);
  }
  return value as Record<string, unknown>;
}

export function requireNonEmptyString(
  value: unknown,
  fieldLabel: string,
  maxLength = 250,
): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${fieldLabel} is required.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HttpError(400, `${fieldLabel} is required.`);
  }
  return trimmed.slice(0, maxLength);
}

export function optionalString(value: unknown, maxLength = 500, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxLength);
}

export function parseFiniteNumber(
  value: unknown,
  fieldLabel: string,
  options?: { min?: number; max?: number; integer?: boolean; fallback?: number },
): number {
  if (value === undefined || value === null || value === '') {
    if (options?.fallback !== undefined) {
      return options.fallback;
    }
    throw new HttpError(400, `${fieldLabel} must be a valid number.`);
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, `${fieldLabel} must be a valid number.`);
  }
  const result = options?.integer ? Math.round(parsed) : parsed;
  if (options?.min !== undefined && result < options.min) {
    throw new HttpError(400, `${fieldLabel} cannot be less than ${options.min}.`);
  }
  if (options?.max !== undefined && result > options.max) {
    throw new HttpError(400, `${fieldLabel} cannot exceed ${options.max}.`);
  }
  return result;
}

export function parseOptionalBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

export function apiErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (res.headersSent) {
    return;
  }

  if (err instanceof HttpError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  const errObj = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
  const errType = typeof errObj?.type === 'string' ? errObj.type : '';

  if (errType === 'entity.too.large') {
    return res.status(413).json({ error: 'Request payload exceeds the maximum allowed size.' });
  }

  if (
    err instanceof SyntaxError &&
    (errObj !== null && ('body' in errObj || errType === 'entity.parse.failed'))
  ) {
    return res.status(400).json({ error: 'Malformed JSON request payload.' });
  }

  const sqliteCode = typeof errObj?.code === 'string' ? errObj.code : '';
  if (sqliteCode.startsWith('SQLITE_CONSTRAINT')) {
    return res.status(409).json({ error: 'A conflicting record already exists.' });
  }

  const statusCode =
    typeof errObj?.statusCode === 'number'
      ? errObj.statusCode
      : typeof errObj?.status === 'number'
        ? errObj.status
        : undefined;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    const message = err instanceof Error ? err.message : 'Invalid request.';
    return res.status(statusCode).json({ error: message });
  }

  console.error('Unhandled API error:', err);
  return res.status(500).json({ error: 'An unexpected server error occurred.' });
}
