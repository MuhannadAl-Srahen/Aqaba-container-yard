import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getSetting, setSetting } from './db';

/**
 * One password guards the whole site — the owner's explicit phase-1 choice,
 * with user accounts deferred. Everything here uses Node's own crypto: scrypt
 * for the stored hash, an HMAC-signed expiring token for the session cookie.
 */

const PASSWORD_KEY = 'password';
const COOKIE_SECRET_KEY = 'cookie_secret';

/** Two weeks — a yard PC stays signed in between shifts without being eternal. */
const SESSION_MS = 14 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE = 'yard_session';

function hashPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 64);
}

export function setPassword(db: DatabaseSync, password: string): void {
  const salt = randomBytes(16);
  const hash = hashPassword(password, salt);
  setSetting(db, PASSWORD_KEY, `${salt.toString('hex')}:${hash.toString('hex')}`);
}

export function hasPassword(db: DatabaseSync): boolean {
  return getSetting(db, PASSWORD_KEY) !== null;
}

export function verifyPassword(db: DatabaseSync, password: string): boolean {
  const stored = getSetting(db, PASSWORD_KEY);
  if (stored === null) return false;

  const [saltHex, hashHex] = stored.split(':');
  if (saltHex === undefined || hashHex === undefined) return false;

  const expected = Buffer.from(hashHex, 'hex');
  const actual = hashPassword(password, Buffer.from(saltHex, 'hex'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function cookieSecret(db: DatabaseSync): Buffer {
  let secret = getSetting(db, COOKIE_SECRET_KEY);
  if (secret === null) {
    secret = randomBytes(32).toString('hex');
    setSetting(db, COOKIE_SECRET_KEY, secret);
  }
  return Buffer.from(secret, 'hex');
}

/** `expiryMs.signature` — nothing user-controlled, nothing to parse loosely. */
export function issueSession(db: DatabaseSync, now: number): string {
  const expires = now + SESSION_MS;
  const signature = createHmac('sha256', cookieSecret(db)).update(String(expires)).digest('hex');
  return `${String(expires)}.${signature}`;
}

export function verifySession(db: DatabaseSync, token: string, now: number): boolean {
  const [expiresText, signature] = token.split('.');
  if (expiresText === undefined || signature === undefined) return false;

  const expires = Number(expiresText);
  if (!Number.isFinite(expires) || expires < now) return false;

  const expected = createHmac('sha256', cookieSecret(db)).update(expiresText).digest();
  const actual = Buffer.from(signature, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
