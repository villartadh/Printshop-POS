import express from 'express';
import { db, writeAuditLog } from '../db.ts';
import {
  createSessionForUser,
  hashSecret,
  requireAuth,
  requireRole,
  sanitizeUser,
  verifySecret,
  type AuthenticatedRequest,
  type UserRow,
} from '../auth.ts';
import {
  optionalString,
  requireNonEmptyString,
  requirePlainObject,
} from '../httpUtils.ts';
import { genId } from '../mappers.ts';

export const authRouter = express.Router();

authRouter.get('/auth/status', (_req, res) => {
  const adminCount = (
    db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND is_active = 1").get() as {
      c: number;
    }
  ).c;
  const users = db
    .prepare('SELECT id, username, full_name, role, pin_hash FROM users WHERE is_active = 1 ORDER BY created_at ASC')
    .all() as Array<{ id: string; username: string; full_name: string; role: string; pin_hash: string }>;

  res.json({
    needsSetup: adminCount === 0,
    quickUsers: users.map((u) => ({
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      role: u.role,
      hasPin: Boolean(u.pin_hash),
    })),
  });
});

authRouter.post('/auth/setup-admin', (req, res) => {
  const body = requirePlainObject(req.body, 'Setup request');
  const username = requireNonEmptyString(body.username, 'Username', 60).toLowerCase();
  const fullName = requireNonEmptyString(body.fullName, 'Full name', 120);
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 6 || password.length > 200) {
    return res
      .status(400)
      .json({ error: 'Username, full name, and a password of at least 6 characters are required.' });
  }
  const pin = body.pin !== undefined && body.pin !== null && body.pin !== '' ? String(body.pin).trim() : '';
  if (pin && !/^\d{4,6}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN must be 4 to 6 digits.' });
  }

  const existingAdmin = db
    .prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1")
    .get();
  if (existingAdmin) {
    return res.status(409).json({ error: 'An administrator account already exists. Please sign in.' });
  }

  const userId = genId('usr');
  const now = new Date().toISOString();
  const pwHash = hashSecret(password);
  const pinHash = pin ? hashSecret(pin) : '';

  db.prepare(`
    INSERT INTO users (id, username, full_name, email, role, password_hash, pin_hash, is_active, preferred_landing_module, created_at)
    VALUES (?, ?, ?, ?, 'admin', ?, ?, 1, 'pos', ?)
  `).run(
    userId,
    username,
    fullName,
    optionalString(body.email, 140),
    pwHash,
    pinHash,
    now,
  );

  const createdUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;
  const session = createSessionForUser(
    createdUser,
    optionalString(body.deviceId, 120, 'web-browser') || 'web-browser',
    optionalString(body.deviceName, 120, 'Web Terminal') || 'Web Terminal',
  );
  return res.status(201).json(session);
});

authRouter.post('/auth/login', (req, res) => {
  const body = requirePlainObject(req.body, 'Login request');
  if (typeof body.username !== 'string' || typeof body.password !== 'string' || !body.username.trim() || !body.password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  const normalized = body.username.trim().slice(0, 140).toLowerCase();
  const userRow = db
    .prepare('SELECT * FROM users WHERE (LOWER(username) = ? OR LOWER(email) = ?) AND is_active = 1')
    .get(normalized, normalized) as UserRow | undefined;

  if (!userRow || !verifySecret(body.password, userRow.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const session = createSessionForUser(
    userRow,
    optionalString(body.deviceId, 120, 'web-browser') || 'web-browser',
    optionalString(body.deviceName, 120, 'Web Terminal') || 'Web Terminal',
  );
  return res.json(session);
});

authRouter.post('/auth/pin-login', (req, res) => {
  const body = requirePlainObject(req.body, 'PIN login request');
  if (typeof body.userId !== 'string' || !body.userId.trim() || (typeof body.pin !== 'string' && typeof body.pin !== 'number')) {
    return res.status(400).json({ error: 'User and PIN are required.' });
  }
  const pinStr = String(body.pin).trim();
  if (!/^\d{4,6}$/.test(pinStr)) {
    return res.status(401).json({ error: 'Invalid cashier PIN.' });
  }
  const userRow = db
    .prepare('SELECT * FROM users WHERE id = ? AND is_active = 1')
    .get(body.userId.trim()) as UserRow | undefined;

  if (!userRow || !userRow.pin_hash || !verifySecret(pinStr, userRow.pin_hash)) {
    return res.status(401).json({ error: 'Invalid cashier PIN.' });
  }

  const session = createSessionForUser(
    userRow,
    optionalString(body.deviceId, 120, 'web-browser') || 'web-browser',
    optionalString(body.deviceName, 120, 'Web Terminal') || 'Web Terminal',
  );
  return res.json(session);
});

authRouter.post('/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
  if (req.sessionId) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.sessionId);
  }
  res.json({ ok: true });
});

authRouter.get('/auth/sessions', requireAuth, (req: AuthenticatedRequest, res) => {
  const rows = db
    .prepare(`
      SELECT s.id, s.user_id, u.full_name as user_name, u.role, s.device_id, s.device_name, s.created_at, s.last_seen_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.expires_at > ?
      ORDER BY s.last_seen_at DESC
    `)
    .all(new Date().toISOString()) as Array<Record<string, unknown>>;

  res.json(
    rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      userName: String(r.user_name),
      role: r.role,
      deviceId: String(r.device_id),
      deviceName: String(r.device_name),
      createdAt: String(r.created_at),
      lastSeenAt: String(r.last_seen_at),
      isCurrent: r.id === req.sessionId,
    })),
  );
});

authRouter.delete('/auth/sessions/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const targetId = String(req.params.id);
  const existing = db.prepare('SELECT user_id FROM sessions WHERE id = ?').get(targetId) as
    | { user_id: string }
    | undefined;
  if (!existing) {
    return res.status(404).json({ error: 'Session not found.' });
  }
  if (existing.user_id !== req.authUser?.id && req.authUser?.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can revoke another user session.' });
  }
  db.prepare('DELETE FROM sessions WHERE id = ?').run(targetId);
  return res.json({ ok: true });
});

authRouter.post('/auth/users', requireAuth, requireRole(['admin']), (req: AuthenticatedRequest, res) => {
  const body = requirePlainObject(req.body, 'User payload');
  const normalized = requireNonEmptyString(body.username, 'Username', 60).toLowerCase();
  const fullName = requireNonEmptyString(body.fullName, 'Full name', 120);
  const password = typeof body.password === 'string' ? body.password : '';
  const role = typeof body.role === 'string' ? body.role : '';
  if (password.length < 6 || password.length > 200) {
    return res.status(400).json({ error: 'Username, full name, and 6+ char password required.' });
  }
  if (!['admin', 'manager', 'cashier', 'operator'].includes(role)) {
    return res.status(400).json({ error: 'Invalid user role.' });
  }
  const pin = body.pin !== undefined && body.pin !== null && body.pin !== '' ? String(body.pin).trim() : '';
  if (pin && !/^\d{4,6}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN must be 4 to 6 digits.' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(normalized);
  if (exists) {
    return res.status(409).json({ error: 'Username already exists.' });
  }

  const id = genId('usr');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, username, full_name, email, role, password_hash, pin_hash, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    id,
    normalized,
    fullName,
    optionalString(body.email, 140),
    role,
    hashSecret(password),
    pin ? hashSecret(pin) : '',
    now,
  );
  writeAuditLog(
    req.authUser!.id,
    req.authUser!.fullName,
    'USER_CREATED',
    'user',
    id,
    `Created ${role} account ${normalized}`,
  );
  const created = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
  return res.status(201).json(sanitizeUser(created));
});

authRouter.patch('/auth/users/:id', requireAuth, requireRole(['admin']), (req: AuthenticatedRequest, res) => {
  const id = String(req.params.id);
  const body = requirePlainObject(req.body, 'User update payload');
  const { fullName, email, role, isActive, newPassword, newPin } = body;
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'User not found.' });

  if (role !== undefined && (typeof role !== 'string' || !['admin', 'manager', 'cashier', 'operator'].includes(role))) {
    return res.status(400).json({ error: 'Invalid user role.' });
  }
  if (newPassword !== undefined && newPassword !== null && newPassword !== '') {
    if (typeof newPassword !== 'string' || newPassword.length < 6 || newPassword.length > 200) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }
  }
  if (newPin !== undefined && newPin !== null && newPin !== '') {
    if (!/^\d{4,6}$/.test(String(newPin).trim())) {
      return res.status(400).json({ error: 'PIN must be 4 to 6 digits.' });
    }
  }
  if (fullName !== undefined && (typeof fullName !== 'string' || !fullName.trim())) {
    return res.status(400).json({ error: 'Full name cannot be empty.' });
  }

  const nextPasswordHash =
    typeof newPassword === 'string' && newPassword.length >= 6
      ? hashSecret(newPassword)
      : String(existing.password_hash);
  const nextPinHash =
    newPin !== undefined
      ? newPin
        ? hashSecret(String(newPin).trim())
        : ''
      : String(existing.pin_hash);

  db.prepare(`
    UPDATE users
    SET full_name = ?, email = ?, role = ?, is_active = ?, password_hash = ?, pin_hash = ?
    WHERE id = ?
  `).run(
    fullName !== undefined ? String(fullName).trim().slice(0, 120) : existing.full_name,
    email !== undefined ? optionalString(email, 140) : existing.email,
    role ?? existing.role,
    typeof isActive === 'boolean' ? (isActive ? 1 : 0) : existing.is_active,
    nextPasswordHash,
    nextPinHash,
    id,
  );
  writeAuditLog(
    req.authUser!.id,
    req.authUser!.fullName,
    'USER_UPDATED',
    'user',
    id,
    `Updated account settings for ${existing.username}`,
  );
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
  return res.json(sanitizeUser(updated));
});
