import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import { planGroupMove, type Standing } from '../src/shared/rules';
import type { MovementDto, Position, Size, YardLayout, ZoneDef } from '../src/shared/types';

/**
 * النقل الجماعي — «خط الباي احيانا بكون فيه 6 حاويات بمكان غير صحيح وبدي
 * انقلهم»: a group, one destination bay, and the planner does what a crane
 * does — takes the top of a stack first, sets the ground down first, fills
 * stack by stack. All or nothing, and every refusal names its cause.
 */

const zoneOf = (bays: readonly number[], stacks: readonly number[]): ZoneDef => ({
  zone: 'B',
  yard: 2,
  x: 0, y: 0, w: 100, h: 100,
  bays: [...bays],
  stacks: Object.fromEntries(bays.map((bay) => [String(bay), [...stacks]])),
});
const layout: YardLayout = { zones: [zoneOf([1, 3, 5, 7], [1, 2])], landmarks: [] };

let nextId = 1;
const box = (position: Position, size: Size = 20): Standing => ({
  id: nextId++,
  number: `GRP${String(nextId).padStart(7, '0')}`,
  size,
  position,
});
const at = (bay: number, stack: number, tier: 'A' | 'B' | 'C'): Position =>
  ({ zone: 'B', bay, stack, tier }) as Position;

describe('planGroupMove — the crane’s own order', () => {
  it('peels a stack from the top and lands it ground-first, inverted', () => {
    const bottom = box(at(1, 1, 'A'));
    const top = box(at(1, 1, 'B'));
    const plan = planGroupMove(layout, [bottom, top], [bottom.id, top.id], { zone: 'B', bay: 5 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // The roof lifts first and takes the ground; the old floor lands on it.
    expect(plan.steps.map((step) => step.id)).toEqual([top.id, bottom.id]);
    expect(plan.steps[0]?.to).toEqual(at(5, 1, 'A'));
    expect(plan.steps[1]?.to).toEqual(at(5, 1, 'B'));
  });

  it('fills the destination stack by stack, three high', () => {
    const line = [box(at(1, 1, 'A')), box(at(1, 2, 'A')), box(at(3, 1, 'A')), box(at(3, 2, 'A'))];
    const plan = planGroupMove(layout, line, line.map((b) => b.id), { zone: 'B', bay: 7 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const landings = plan.steps.map((step) => `${String(step.to.stack)}${step.to.tier}`);
    expect(landings).toEqual(['1A', '1B', '1C', '2A']);
  });

  it('lands a forty across an even bay beside the named one', () => {
    const forty = box(at(2, 1, 'A'), 40);
    const plan = planGroupMove(layout, [forty], [forty.id], { zone: 'B', bay: 5 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.steps[0]?.to.bay).toBe(6);
  });

  it('refuses when an outsider stands on a selected container, and names it', () => {
    const mine = box(at(1, 1, 'A'));
    const outsider = box(at(1, 1, 'B'));
    const plan = planGroupMove(layout, [mine, outsider], [mine.id], { zone: 'B', bay: 5 });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe('GROUP_BURIED');
    expect(plan.other).toBe(outsider.number);
  });

  it('refuses a destination that takes only part, by the count', () => {
    // Bay 5 has 2 stacks × 3 tiers = 6 cells; one stack is walled off by a
    // standing outsider tower of three, leaving room for three.
    const towers = [box(at(5, 1, 'A')), box(at(5, 1, 'B')), box(at(5, 1, 'C'))];
    const group = [box(at(1, 1, 'A')), box(at(1, 2, 'A')), box(at(3, 1, 'A')), box(at(3, 2, 'A'))];
    const plan = planGroupMove(layout, [...towers, ...group], group.map((b) => b.id), {
      zone: 'B',
      bay: 5,
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe('GROUP_NO_ROOM');
    expect(plan.fit).toBe(3);
    expect(plan.total).toBe(4);
  });

  it('refuses ground the plan does not have', () => {
    const one = box(at(1, 1, 'A'));
    const plan = planGroupMove(layout, [one], [one.id], { zone: 'B', bay: 33 });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe('BAD_SLOT');
  });
});

describe('POST /api/containers/move-many', () => {
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

  const gateIn = async (number: string, bay: number, stack: number): Promise<number> => {
    const reply = await call({
      method: 'POST',
      url: '/api/containers',
      payload: {
        number,
        size: 20,
        bill: '7100',
        notes: '',
        position: { zone: 'B', bay, stack, tier: 'A' },
        truck: '60-11111',
        seal: 'JO500',
        driver: 'أبو خالد',
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

  it('moves the group in one transaction, a numbered card each', async () => {
    const ids = [
      await gateIn('GRPA0011', 1, 1),
      await gateIn('GRPA0027', 1, 2),
      await gateIn('GRPA0032', 3, 1),
    ];
    const moved = await call({
      method: 'POST',
      url: '/api/containers/move-many',
      payload: { ids, to: { zone: 'B', bay: 7 } },
    });
    expect(moved.status).toBe(200);
    expect(moved.body['moved']).toBe(3);

    const serials: number[] = [];
    for (const id of ids) {
      const detail = (await call({ method: 'GET', url: `/api/containers/${String(id)}` }))
        .body as unknown as { container: { position: Position }; movements: MovementDto[] };
      expect(detail.container.position.bay).toBe(7);
      const move = detail.movements.find((m) => m.type === 'MOVE');
      expect(move?.card).not.toBeNull();
      serials.push(move?.card ?? 0);
    }
    // Three cards, three distinct serials from one book.
    expect(new Set(serials).size).toBe(3);
  });

  it('refuses ground the plan does not have, before anything moves', async () => {
    const ids = [await gateIn('GRPB0011', 1, 1), await gateIn('GRPB0027', 1, 2)];
    const bad = await call({
      method: 'POST',
      url: '/api/containers/move-many',
      payload: { ids, to: { zone: 'B', bay: 77 } },
    });
    expect(bad.status).toBe(409);
    expect(bad.body['code']).toBe('BAD_SLOT');
    // Nobody moved.
    const detail = (await call({ method: 'GET', url: `/api/containers/${String(ids[0])}` }))
      .body as unknown as { container: { position: Position } };
    expect(detail.container.position.bay).toBe(1);
  });

  it('is barred without the MOVE permission', async () => {
    const id = await gateIn('GRPC0011', 1, 1);
    await call({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'كاتب', pin: '4321', permissions: ['REPORTS'] },
    });
    const staff = (await call({ method: 'GET', url: '/api/users' })).body as unknown as {
      users: Array<{ id: number; name: string }>;
    };
    const clerk = staff.users.find((user) => user.name === 'كاتب');
    await call({ method: 'POST', url: '/api/logout' });
    cookie = '';
    await call({ method: 'POST', url: '/api/login', payload: { userId: clerk?.id, pin: '4321' } });
    const refused = await call({
      method: 'POST',
      url: '/api/containers/move-many',
      payload: { ids: [id], to: { zone: 'B', bay: 7 } },
    });
    expect(refused.status).toBe(403);
  });
});
