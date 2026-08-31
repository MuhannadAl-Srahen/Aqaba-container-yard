import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import * as store from '../src/server/store';
import { cardsBookHtml } from '../src/client/cardsPrint';
import type { CardSheetRow, Position } from '../src/shared/types';

/**
 * الطباعة الكلية للبطاقات — «بدي طريقة اطبع جميع بطاقات الدخول مره واحدة
 * وجميع بطاقات الخروج مره واحدة مهما كان عددها فقط تحت صلاحية المالك».
 *
 * The split of duties is the thing under test: the server hands FACTS from
 * an owner-only route, ordered as the bound book reads (serial within its
 * year); the client writes the Arabic book around them. Arabic lives in
 * ar.ts alone, so the builder is client code and the wire carries data.
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

const at = (bay: number, stack = 1, tier: 'A' | 'B' | 'C' = 'A'): Position =>
  ({ zone: 'B', bay, stack, tier }) as Position;

const gateIn = async (number: string, bay: number): Promise<number> => {
  const reply = await call({
    method: 'POST',
    url: '/api/containers',
    payload: {
      number,
      size: 20,
      bill: '7100',
      notes: '',
      position: at(bay),
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

const WIDE = { from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z' };

describe('بيانات البطاقات دفعة واحدة', () => {
  it('entry cards come in serial order, struck-out records left out', async () => {
    const first = await gateIn('BULK0011', 1);
    await gateIn('BULK0027', 3);
    const third = await gateIn('BULK0032', 5);
    await call({ method: 'DELETE', url: `/api/containers/${String(third)}` });

    const rows = store.bulkGateCards(db, 'IN', WIDE.from, WIDE.to);
    expect(rows.map((row) => row.serial)).toEqual([1, 2]);
    expect(rows[0]?.number).toBe('BULK0011');
    expect(rows[0]?.handling).toBe('CRANE');
    expect(rows[0]?.slot?.bay).toBe(1);
    expect(rows[0]?.truck).toBe('60-11111');
    expect(rows[0]?.photoIds).toEqual([]);
    expect(rows.some((row) => row.containerId === first)).toBe(true);
  });

  it('exit cards carry the exit paperwork and the slot it left from', async () => {
    const id = await gateIn('BULK0046', 1);
    await gateIn('BULK0059', 3);
    await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/exit`,
      payload: { truck: '60-22222', driver: 'أبو علي' },
    });

    const rows = store.bulkGateCards(db, 'OUT', WIDE.from, WIDE.to);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.serial).toBe(1);
    expect(rows[0]?.truck).toBe('60-22222');
    expect(rows[0]?.driver).toBe('أبو علي');
    expect(rows[0]?.slot?.bay).toBe(1);
    // The exit card still says when it went INTO store.
    expect(rows[0]?.enteredAt).not.toBe('');
    expect(rows[0]?.handling).toBeNull();
  });

  it('move cards are the numbered moves of the range, from and to', async () => {
    const id = await gateIn('BULK0063', 1);
    const moved = await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/move`,
      payload: { to: at(3) },
    });
    expect(moved.status).toBe(200);

    const rows = store.bulkMoveCards(db, WIDE.from, WIDE.to);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.serial).toBe(1);
    expect(rows[0]?.from?.bay).toBe(1);
    expect(rows[0]?.to?.bay).toBe(3);
    expect(rows[0]?.truck).toBe('');
  });

  it('the range clips: a gate outside it prints no card', async () => {
    await gateIn('BULK0074', 1);
    const rows = store.bulkGateCards(db, 'IN', '2000-01-01T00:00:00.000Z', '2001-01-01T00:00:00.000Z');
    expect(rows).toHaveLength(0);
  });
});

describe('مسار المالك وحده', () => {
  it('hands the owner the rows, by kind', async () => {
    await gateIn('BULK0088', 1);
    const reply = await call({
      method: 'GET',
      url: `/api/reports/cards?kind=in&from=${WIDE.from}&to=${WIDE.to}`,
    });
    expect(reply.status).toBe(200);
    const rows = reply.body['rows'] as CardSheetRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.number).toBe('BULK0088');
  });

  it('refuses a clerk with every permission — the owner alone', async () => {
    await call({
      method: 'POST',
      url: '/api/users',
      payload: {
        name: 'كاتب',
        pin: '4321',
        permissions: ['GATE_IN', 'GATE_OUT', 'MOVE', 'EDIT', 'DELETE', 'REPORTS', 'ACCOUNTING'],
      },
    });
    const staff = (await call({ method: 'GET', url: '/api/users' })).body as unknown as {
      users: Array<{ id: number; name: string }>;
    };
    const clerk = staff.users.find((user) => user.name === 'كاتب');
    await call({ method: 'POST', url: '/api/logout' });
    cookie = '';
    await call({ method: 'POST', url: '/api/login', payload: { userId: clerk?.id, pin: '4321' } });

    const data = await call({
      method: 'GET',
      url: `/api/reports/cards?kind=in&from=${WIDE.from}&to=${WIDE.to}`,
    });
    expect(data.status).toBe(403);
    const pdf = await call({
      method: 'POST',
      url: '/api/reports/cards-pdf',
      payload: { title: 'بطاقات', html: '<p>x</p>' },
    });
    expect(pdf.status).toBe(403);
  });

  it('a bad kind or a broken range is refused before any work', async () => {
    expect(
      (await call({ method: 'GET', url: `/api/reports/cards?kind=x&from=${WIDE.from}&to=${WIDE.to}` }))
        .status,
    ).toBe(400);
    expect(
      (await call({ method: 'POST', url: '/api/reports/cards-pdf', payload: { title: '', html: '' } }))
        .status,
    ).toBe(400);
  });
});

describe('كتاب البطاقات — the client-written book', () => {
  const card = (over: Partial<CardSheetRow>): CardSheetRow => ({
    containerId: 1,
    number: 'MSCU1234566',
    serial: 7,
    serialYear: 2026,
    at: '2026-08-30T09:00:00.000Z',
    bill: 'JO-9',
    size: 20,
    weight: '19500',
    seal: 'JO500',
    notes: '',
    enteredAt: '2026-08-28T07:00:00.000Z',
    handling: 'CRANE',
    truck: '60-11111',
    driver: 'أبو خالد',
    slot: { zone: 'B', bay: 3, stack: 1, tier: 'A' } as Position,
    from: null,
    to: null,
    note: '',
    photoIds: [],
    ...over,
  });

  it('a page per card, in the order the rows arrived', () => {
    const html = cardsBookHtml('in', [card({ serial: 1, number: 'AAAA0000001' }), card({ serial: 2, number: 'BBBB0000002' })], new Map());
    expect(html).toContain('dir="rtl"');
    expect((html.match(/<section class="card">/g) ?? []).length).toBe(2);
    expect(html.indexOf('AAAA0000001')).toBeLessThan(html.indexOf('BBBB0000002'));
    // Every section after the first opens its own page.
    expect(html).toContain('section{break-before:page');
    // The serial prints padded, the year beneath it.
    expect(html).toContain('0001');
    expect(html).toContain('2026');
  });

  it('the entry card carries the receipt and the handling; the exit does not', () => {
    const entry = cardsBookHtml('in', [card({})], new Map());
    const exit = cardsBookHtml('out', [card({ handling: null })], new Map());
    expect(entry).toContain('class="statement"');
    expect(exit).not.toContain('class="statement"');
  });

  it('a move card names its two slots and its drops', () => {
    const html = cardsBookHtml(
      'move',
      [
        card({
          from: { zone: 'B', bay: 1, stack: 1, tier: 'A' } as Position,
          to: { zone: 'B', bay: 3, stack: 1, tier: 'A' } as Position,
          note: JSON.stringify({ d: [{ n: 'DROP0000001', f: '2-B-01-01-B', t: '2-B-01-01-A' }] }),
        }),
      ],
      new Map(),
    );
    expect(html).toContain('DROP0000001');
    expect(html).toContain('2-B-01-01-B');
  });

  it('photos ride as data-URI pages only when handed in', () => {
    const uri = 'data:image/jpeg;base64,AAAA';
    const withPages = cardsBookHtml('in', [card({ photoIds: [5] })], new Map([[1, [uri]]]));
    expect(withPages).toContain(uri);
    expect((withPages.match(/<section/g) ?? []).length).toBe(2);
    const without = cardsBookHtml('in', [card({ photoIds: [5] })], new Map());
    expect(without).not.toContain('data:image');
    // Never a session-bound relative URL — the server's browser has none.
    expect(withPages).not.toContain('/api/photos/');
  });

  it('a value is escaped before it is ink', () => {
    const html = cardsBookHtml('in', [card({ notes: '<b>ملاحظة</b>' })], new Map());
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>ملاحظة');
  });
});
