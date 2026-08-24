import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type { ContainerDto, MovementDto, Position } from '../src/shared/types';

/**
 * تصحيح النقلة — «بالنسبة لتعديل النقل نعم تعديل»: a move recorded onto the
 * wrong slot is corrected in place. The movement row and its printed card
 * learn the true slot, the container stands there, and no second move is
 * born. Only the LAST placement corrects; a buried box refuses; the landing
 * obeys every ground rule.
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

const gateIn = async (number: string, position: Position): Promise<number> => {
  const reply = await call({
    method: 'POST',
    url: '/api/containers',
    payload: {
      number,
      size: 20,
      bill: '9900',
      notes: '',
      position,
      truck: '60-33333',
      seal: 'JO700',
      driver: '',
      weight: '',
      handling: 'CRANE',
    },
  });
  expect(reply.status).toBe(201);
  return reply.body['id'] as number;
};

const move = async (id: number, to: Position): Promise<void> => {
  expect(
    (await call({ method: 'POST', url: `/api/containers/${String(id)}/move`, payload: { to } }))
      .status,
  ).toBe(200);
};

const lastMove = async (id: number): Promise<MovementDto> => {
  const detail = await call({ method: 'GET', url: `/api/containers/${String(id)}` });
  const movements = detail.body['movements'] as MovementDto[];
  const found = [...movements].reverse().find((movement) => movement.type === 'MOVE');
  expect(found).toBeDefined();
  if (found === undefined) throw new Error('unreachable');
  return found;
};

const correct = async (
  movementId: number,
  to: Position,
): Promise<{ status: number; body: Record<string, unknown> }> =>
  call({ method: 'POST', url: `/api/movements/${String(movementId)}/correct`, payload: { to } });

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

describe('تصحيح النقلة الأخيرة', () => {
  it('rewrites the record and its card in place — same serial, true slot', async () => {
    const id = await gateIn('CORR0015', { zone: 'B', bay: 3, stack: 1, tier: 'A' });
    await move(id, { zone: 'B', bay: 5, stack: 1, tier: 'A' });
    const wrong = await lastMove(id);
    const serial = wrong.card;

    const fixed = await correct(wrong.id, { zone: 'B', bay: 7, stack: 1, tier: 'A' });
    expect(fixed.status).toBe(200);
    const container = fixed.body['container'] as ContainerDto;
    expect(container.position).toEqual({ zone: 'B', bay: 7, stack: 1, tier: 'A' });
    const corrected = fixed.body['move'] as MovementDto;
    expect(corrected.id).toBe(wrong.id);
    expect(corrected.to).toEqual({ zone: 'B', bay: 7, stack: 1, tier: 'A' });
    // The card is the SAME paper corrected, not a second one.
    expect(corrected.card).toBe(serial);
    // The trail says a correction happened.
    const detail = await call({ method: 'GET', url: `/api/containers/${String(id)}` });
    const movements = detail.body['movements'] as MovementDto[];
    expect(movements.filter((movement) => movement.type === 'MOVE')).toHaveLength(1);
    expect(movements.at(-1)?.type).toBe('EDIT');
  });

  it('corrects only the LAST placement, refuses a buried box and a taken slot', async () => {
    const id = await gateIn('CORR0020', { zone: 'B', bay: 3, stack: 1, tier: 'A' });
    await move(id, { zone: 'B', bay: 5, stack: 1, tier: 'A' });
    const first = await lastMove(id);
    await move(id, { zone: 'B', bay: 7, stack: 1, tier: 'A' });
    const second = await lastMove(id);

    // The older move is history; only the last one corrects.
    const stale = await correct(first.id, { zone: 'B', bay: 9, stack: 1, tier: 'A' });
    expect(stale.status).toBe(409);
    expect(stale.body['code']).toBe('NOT_LAST_MOVE');

    // A taken slot refuses like any landing.
    await gateIn('CORR0036', { zone: 'B', bay: 11, stack: 1, tier: 'A' });
    const taken = await correct(second.id, { zone: 'B', bay: 11, stack: 1, tier: 'A' });
    expect(taken.status).toBe(409);
    expect(taken.body['code']).toBe('OCCUPIED');

    // Same recorded slot: nothing to correct.
    const same = await correct(second.id, { zone: 'B', bay: 7, stack: 1, tier: 'A' });
    expect(same.status).toBe(409);
    expect(same.body['code']).toBe('SAME_SLOT');

    // Once another box rests on it, the record under it holds still.
    await gateIn('CORR0041', { zone: 'B', bay: 7, stack: 1, tier: 'B' });
    const buried = await correct(second.id, { zone: 'B', bay: 9, stack: 1, tier: 'A' });
    expect(buried.status).toBe(409);
    expect(buried.body['code']).toBe('MOVE_BURIED');
  });
});
