import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { OWNER_ID } from '../shared/types';
import { getSetting, setSetting } from './db';

/**
 * Two kinds of sign-in, one mechanism. The owner has the site password; each
 * employee has a PIN. Both are stored the same way — scrypt over a random
 * salt — and both end in the same signed cookie, which now carries WHO signed
 * in so every write can be attributed to a person.
 */

const PASSWORD_KEY = 'password';
const COOKIE_SECRET_KEY = 'cookie_secret';

/**
 * One hour of stillness and the door closes — «واحد بفتح تلفونه او كمبيوتر
 * بعدين بدو يجي يفتح بفتح مره ثانية دون ما يدخل كلمة السر». The client
 * renews the hour on real human touch (a throttled ping), so a working
 * clerk is never interrupted; a phone left in a pocket signs itself out.
 */
export const SESSION_MS = 60 * 60 * 1000;

export const SESSION_COOKIE = 'yard_session';

/** `salt:hash`, hex. The one storage form for every secret in the system. */
export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(secret, salt, 64).toString('hex')}`;
}

/** Constant-time check of a secret against its stored `salt:hash`. */
export function verifySecret(stored: string | null, secret: string): boolean {
  if (stored === null) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (saltHex === undefined || hashHex === undefined) return false;

  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(secret, Buffer.from(saltHex, 'hex'), 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function setPassword(db: DatabaseSync, password: string): void {
  setSetting(db, PASSWORD_KEY, hashSecret(password));
}

export function hasPassword(db: DatabaseSync): boolean {
  return getSetting(db, PASSWORD_KEY) !== null;
}

export function verifyPassword(db: DatabaseSync, password: string): boolean {
  return verifySecret(getSetting(db, PASSWORD_KEY), password);
}

function cookieSecret(db: DatabaseSync): Buffer {
  let secret = getSetting(db, COOKIE_SECRET_KEY);
  if (secret === null) {
    secret = randomBytes(32).toString('hex');
    setSetting(db, COOKIE_SECRET_KEY, secret);
  }
  return Buffer.from(secret, 'hex');
}

/**
 * `userId.expiryMs.signature` — the actor is inside the signature, so a
 * cookie cannot be edited into somebody else's. Tokens from before employees
 * existed had two parts and no longer parse: everyone signs in once more,
 * which is the right thing for the release that introduces accounts.
 */
export function issueSession(db: DatabaseSync, userId: number, now: number): string {
  const expires = now + SESSION_MS;
  const payload = `${String(userId)}.${String(expires)}`;
  const signature = createHmac('sha256', cookieSecret(db)).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

/** The signed-in user's id (OWNER_ID for the owner), or null for no session. */
export function verifySession(db: DatabaseSync, token: string, now: number): number | null {
  const [userText, expiresText, signature] = token.split('.');
  if (userText === undefined || expiresText === undefined || signature === undefined) return null;

  const userId = Number(userText);
  const expires = Number(expiresText);
  if (!Number.isInteger(userId) || userId < OWNER_ID) return null;
  if (!Number.isFinite(expires) || expires < now) return null;

  const expected = createHmac('sha256', cookieSecret(db))
    .update(`${userText}.${expiresText}`)
    .digest();
  const actual = Buffer.from(signature, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return userId;
}
