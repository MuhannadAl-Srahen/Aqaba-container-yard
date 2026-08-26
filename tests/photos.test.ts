import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type { PhotoDto } from '../src/shared/types';

/**
 * صور الحاوية: the bytes live in the database itself, so a backup carries
 * the photos with everything else and the restore brings them back — no
 * second machinery beside the one the yard already trusts.
 */

let db: DatabaseSync;
let app: FastifyInstance;
let cookie = '';

const call = async (
  options: InjectOptions,
): Promise<{ status: number; body: Record<string, unknown>; bytes: Buffer }> => {
  const response = await app.inject({
    ...options,
    headers: { ...options.headers, ...(cookie === '' ? {} : { cookie }) },
  });
  const set = response.headers['set-cookie'];
  if (typeof set === 'string') cookie = set.split(';')[0] ?? cookie;
  let body: unknown = null;
  try {
    body = response.json();
  } catch {
    body = response.body;
  }
  return {
    status: response.statusCode,
    body: body as Record<string, unknown>,
    bytes: response.rawPayload,
  };
};

const seedContainer = async (): Promise<number> => {
  const reply = await call({
    method: 'POST',
    url: '/api/containers',
    payload: {
      number: 'FOTO0016',
      size: 20,
      bill: '8800',
      notes: '',
      position: { zone: 'B', bay: 3, stack: 1, tier: 'A' },
      truck: '60-22222',
      seal: 'JO600',
      driver: '',
      weight: '',
      handling: 'CRANE',
    },
  });
  expect(reply.status).toBe(201);
  return reply.body['id'] as number;
};

const upload = async (
  id: number,
  bytes: Buffer,
  mime = 'image/jpeg',
): Promise<{ status: number; body: Record<string, unknown> }> =>
  call({
    method: 'POST',
    url: `/api/containers/${String(id)}/photos`,
    headers: { 'content-type': mime },
    payload: bytes,
  });

const setup = async (database: DatabaseSync): Promise<void> => {
  db = database;
  app = buildApp(db);
  cookie = '';
  await call({ method: 'POST', url: '/api/setup', payload: { password: 'owner-secret-1' } });
  await call({ method: 'POST', url: '/api/login', payload: { password: 'owner-secret-1' } });
};

afterEach(() => {
  db.close();
});

describe('صور الحاوية', () => {
  beforeEach(async () => {
    await setup(openDatabase(':memory:'));
  });

  it('uploads, lists, serves the same bytes back, and soft-deletes', async () => {
    const id = await seedContainer();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9]);
    const added = await upload(id, jpeg);
    expect(added.status).toBe(201);
    const photoId = added.body['id'] as number;

    const listed = await call({ method: 'GET', url: `/api/containers/${String(id)}/photos` });
    const photos = listed.body['photos'] as PhotoDto[];
    expect(photos).toHaveLength(1);
    expect(photos[0]?.mime).toBe('image/jpeg');
    expect(photos[0]?.size).toBe(jpeg.byteLength);

    const served = await call({ method: 'GET', url: `/api/photos/${String(photoId)}` });
    expect(served.status).toBe(200);
    expect(Buffer.compare(served.bytes, jpeg)).toBe(0);

    expect(
      (await call({ method: 'DELETE', url: `/api/photos/${String(photoId)}` })).status,
    ).toBe(200);
    expect(
      ((await call({ method: 'GET', url: `/api/containers/${String(id)}/photos` }))
        .body['photos'] as PhotoDto[]).length,
    ).toBe(0);
    expect((await call({ method: 'GET', url: `/api/photos/${String(photoId)}` })).status).toBe(
      404,
    );
  });

  it('refuses a photo for a record that does not exist', async () => {
    const lost = await upload(9999, Buffer.from([1, 2, 3]));
    expect(lost.status).toBe(404);
  });

  it('the gate clerk attaches photos with GATE_IN alone, but striking out stays EDIT work', async () => {
    const id = await seedContainer();
    await call({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'بوابة', pin: '7788', permissions: ['GATE_IN'] },
    });
    const listed = (await call({ method: 'GET', url: '/api/users' })).body as unknown as {
      users: Array<{ id: number; name: string }>;
    };
    const clerk = listed.users.find((user) => user.name === 'بوابة');
    await call({ method: 'POST', url: '/api/logout' });
    cookie = '';
    await call({ method: 'POST', url: '/api/login', payload: { userId: clerk?.id, pin: '7788' } });
    const added = await upload(id, Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]));
    expect(added.status).toBe(201);
    const photoId = added.body['id'] as number;
    expect((await call({ method: 'DELETE', url: `/api/photos/${String(photoId)}` })).status).toBe(
      403,
    );
  });
});

describe('الصور في النسخة الاحتياطية', () => {
  beforeEach(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'yard-photos-'));
    await setup(openDatabase(path.join(dir, 'yard.db')));
  });

  it('a restore brings the photos back with everything else', async () => {
    const id = await seedContainer();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7, 0xff, 0xd9]);
    const added = await upload(id, jpeg);
    const photoId = added.body['id'] as number;

    const backup = await call({ method: 'POST', url: '/api/backup' });
    expect(backup.status).toBe(200);

    // The photo is struck after the snapshot; the restore stands it back up.
    await call({ method: 'DELETE', url: `/api/photos/${String(photoId)}` });
    const restored = await call({
      method: 'POST',
      url: '/api/owner/restore',
      headers: { 'content-type': 'application/octet-stream' },
      payload: backup.bytes,
    });
    expect(restored.status).toBe(200);

    const served = await call({ method: 'GET', url: `/api/photos/${String(photoId)}` });
    expect(served.status).toBe(200);
    expect(Buffer.compare(served.bytes, jpeg)).toBe(0);
  });

  it('a restore lands even before this install ever took a backup', async () => {
    const id = await seedContainer();
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 5, 5, 0xff, 0xd9]);
    const added = await upload(id, jpeg);
    const photoId = added.body['id'] as number;
    const backup = await call({ method: 'POST', url: '/api/backup' });

    // A brand-new install: no snapshot was ever taken, so backups/ does not
    // exist — the very first thing this owner does is restore the old yard.
    const freshDir = mkdtempSync(path.join(tmpdir(), 'yard-fresh-'));
    const freshDb = openDatabase(path.join(freshDir, 'yard.db'));
    const fresh = buildApp(freshDb);
    const setupRes = await fresh.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { password: 'owner-secret-2' },
    });
    const header = setupRes.headers['set-cookie'];
    const freshCookie =
      (Array.isArray(header) ? header[0] : header)?.split(';')[0] ?? '';
    const restored = await fresh.inject({
      method: 'POST',
      url: '/api/owner/restore',
      headers: { cookie: freshCookie, 'content-type': 'application/octet-stream' },
      payload: backup.bytes,
    });
    expect(restored.statusCode).toBe(200);
    const served = await fresh.inject({
      method: 'GET',
      url: `/api/photos/${String(photoId)}`,
      headers: { cookie: freshCookie },
    });
    expect(served.statusCode).toBe(200);
    expect(Buffer.compare(served.rawPayload, jpeg)).toBe(0);
    freshDb.close();
  });
});
