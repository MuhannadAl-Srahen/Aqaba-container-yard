import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type { ContainerDto, Position } from '../src/shared/types';

/**
 * سجل الحاوية الخارجة: it can be struck out — «عند خروج الحاوية قد احتاج
 * الى حذف الحاوية من السجل» — and the year's ledgers close over both of
 * its numbers. And the search box reaches the seal: «القدرة على البحث على
 * الرصاصة».
 */

let db: DatabaseSync;
let app: FastifyInstance;
let cookie = '';

const call = async (
  options: InjectOptions,
): Promise<{ status: number; body: Record<string, unknown> }> => {
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
  return { status: response.statusCode, body: body as Record<string, unknown> };
};

const gateIn = async (number: string, position: Position, seal: string): Promise<number> => {
  const reply = await call({
    method: 'POST',
    url: '/api/containers',
    payload: {
      number,
      size: 20,
      bill: '4400',
      notes: '',
      position,
      truck: '60-70001',
      seal,
      driver: '',
      weight: '',
      handling: 'CRANE',
    },
  });
  expect(reply.status).toBe(201);
  return reply.body['id'] as number;
};

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  cookie = '';
  await call({ method: 'POST', url: '/api/setup', payload: { password: 'owner-secret-1' } });
  await call({ method: 'POST', url: '/api/login', payload: { password: 'owner-secret-1' } });
});
afterEach(() => {
  db.close();
});

describe('سجل الخارجة', () => {
  it('an exited record deletes, and both ledgers keep the holes it leaves', async () => {
    const first = await gateIn('EXDL0010', { zone: 'B', bay: 3, stack: 1, tier: 'A' }, 'JO111');
    const second = await gateIn('EXDL0025', { zone: 'B', bay: 5, stack: 1, tier: 'A' }, 'JO112');
    await call({
      method: 'POST',
      url: `/api/containers/${String(first)}/exit`,
      payload: { truck: '60-70001', driver: '' },
    });
    const removed = await call({ method: 'DELETE', url: `/api/containers/${String(first)}` });
    expect(removed.status).toBe(200);
    // The survivor keeps the entry card it was printed with — 2, not 1. Its
    // paper is already in a drawer and the register must still match it.
    const detail = await call({ method: 'GET', url: `/api/containers/${String(second)}` });
    expect((detail.body['container'] as ContainerDto).cardIn).toBe(2);
    // The record is gone from the search.
    const found = await call({ method: 'GET', url: '/api/containers?q=EXDL0010' });
    expect(found.body['results']).toHaveLength(0);
  });

  it('the search box reaches the seal, standing or departed', async () => {
    const id = await gateIn('SEAL0018', { zone: 'B', bay: 7, stack: 1, tier: 'A' }, 'XK9901');
    const bySeal = await call({ method: 'GET', url: '/api/containers?q=XK9901' });
    expect(
      (bySeal.body['results'] as ContainerDto[]).map((container) => container.number),
    ).toEqual(['SEAL0018']);
    // Departed, the seal still finds the record.
    await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/exit`,
      payload: { truck: '60-70001', driver: '' },
    });
    const after = await call({ method: 'GET', url: '/api/containers?q=XK9901' });
    expect((after.body['results'] as ContainerDto[]).map((c) => c.number)).toEqual(['SEAL0018']);
  });
});
