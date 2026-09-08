import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type { ContainerDto, Position } from '../src/shared/types';

/**
 * الرقم التسلسلي لا يُعطى مرتين.
 *
 * The owner reversed his own earlier rule. It used to be «في حال حذف الحاوية
 * او سجل خطأ يجب ان لا يتم القفز عن الرقم التسلسلي» — close the hole. It is
 * now the opposite, and he wrote out the example himself:
 *
 *   «لو كان عندي 1 2 3 وحذفت 3، الي بدي اجي اضيفها خلص لازم تيجي 4، مو توخذ
 *    محل ال 3»
 *
 * The reversal is the better trade, and the old rule's own cost is why:
 * closing a hole moved the numbers of records that had nothing to do with the
 * mistake, so a card already printed and handed to a driver stopped matching
 * the register it came from. A hole is visible and harmless. A number that
 * changes hands is neither.
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

const at = (bay: number): Position => ({ zone: 'B', bay, stack: 1, tier: 'A' }) as Position;

const gateIn = async (number: string, bay: number): Promise<ContainerDto> => {
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
  return reply.body as unknown as ContainerDto;
};

const detail = async (id: number): Promise<ContainerDto> =>
  (
    (await call({ method: 'GET', url: `/api/containers/${String(id)}` })).body as unknown as {
      container: ContainerDto;
    }
  ).container;

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

describe('الرقم التسلسلي لا يُعطى مرتين', () => {
  /** His example, run through the real gate. */
  it('1, 2, 3 — strike 3 out and the next one is 4', async () => {
    const first = await gateIn('SER00011', 1);
    const second = await gateIn('SER00027', 3);
    const third = await gateIn('SER00032', 5);
    expect([first.cardIn, second.cardIn, third.cardIn]).toEqual([1, 2, 3]);

    const struck = await call({ method: 'DELETE', url: `/api/containers/${String(third.id)}` });
    expect(struck.status).toBe(200);

    const next = await gateIn('SER00046', 7);
    expect(next.cardIn).toBe(4);

    // And the two survivors were not touched.
    expect((await detail(first.id)).cardIn).toBe(1);
    expect((await detail(second.id)).cardIn).toBe(2);
  });

  /**
   * The real reason to prefer holes: a serial is the order the PAPER was
   * issued in, and that paper has left the building. Correcting a gate date
   * afterwards must not re-seat it.
   */
  it('correcting a gate date does not move the serial', async () => {
    const first = await gateIn('SER00059', 1);
    const second = await gateIn('SER00063', 3);
    expect([first.cardIn, second.cardIn]).toEqual([1, 2]);

    // The second one actually arrived a week BEFORE the first.
    const live = await detail(second.id);
    const edited = await call({
      method: 'PATCH',
      url: `/api/containers/${String(second.id)}`,
      payload: {
        number: live.number,
        bill: live.bill,
        size: live.size,
        notes: live.notes,
        weight: live.weight,
        handling: live.handling,
        truckIn: live.truckIn,
        driverIn: live.driverIn,
        sealIn: live.sealIn,
        truckOut: live.truckOut,
        driverOut: live.driverOut,
        enteredAt: new Date(Date.parse(live.enteredAt) - 7 * 86_400_000).toISOString(),
        exitedAt: live.exitedAt,
      },
    });
    expect(edited.status).toBe(200);

    // Its card still reads 2, exactly as the paper does.
    expect((await detail(second.id)).cardIn).toBe(2);
    expect((await detail(first.id)).cardIn).toBe(1);
  });

  it('a struck-out record brought back keeps its own number', async () => {
    const first = await gateIn('SER00074', 1);
    const second = await gateIn('SER00088', 3);
    await call({ method: 'DELETE', url: `/api/containers/${String(first.id)}` });
    const third = await gateIn('SER00091', 5);
    expect(third.cardIn).toBe(3);

    const back = await call({ method: 'POST', url: `/api/containers/${String(first.id)}/restore` });
    expect(back.status).toBe(200);
    expect((await detail(first.id)).cardIn).toBe(1);
    expect((await detail(second.id)).cardIn).toBe(2);
    expect((await detail(third.id)).cardIn).toBe(3);
  });

  /**
   * A book kept under the OLD rule is full of collisions: closing a hole moved
   * a live card onto a number a struck-out record was still holding. The
   * owner's own database carries thirteen. Restoring such a record must not
   * put two live cards on one number — and must not move anybody else either.
   */
  it('a legacy collision is resolved by moving the restored record alone', async () => {
    const kept = await gateIn('SER00102', 1);
    const struck = await gateIn('SER00115', 3);
    expect([kept.cardIn, struck.cardIn]).toEqual([1, 2]);
    await call({ method: 'DELETE', url: `/api/containers/${String(struck.id)}` });

    const later = await gateIn('SER00129', 5);
    expect(later.cardIn).toBe(3);

    // Forge the state the old renumbering used to create: a LIVE record
    // sitting on the serial the struck-out one still holds.
    db.prepare('UPDATE containers SET card_in = 2 WHERE id = ?').run(later.id);
    expect((await detail(later.id)).cardIn).toBe(2);

    const back = await call({ method: 'POST', url: `/api/containers/${String(struck.id)}/restore` });
    expect(back.status).toBe(200);

    // The restored record took a fresh number; the live card that had taken
    // its old one keeps what is printed on its paper.
    const restored = await detail(struck.id);
    expect(restored.cardIn).not.toBe(2);
    expect((await detail(later.id)).cardIn).toBe(2);
    expect((await detail(kept.id)).cardIn).toBe(1);

    // And no two live records of the year share a number.
    const live = db
      .prepare(
        `SELECT card_in AS serial FROM containers
          WHERE deleted_at IS NULL AND card_in_year IS NOT NULL`,
      )
      .all() as Array<{ serial: number }>;
    const serials = live.map((row) => row.serial);
    expect(new Set(serials).size).toBe(serials.length);
  });

  it('the exit ledger keeps its own holes, and the permit book too', async () => {
    const one = await gateIn('SER00132', 1);
    const two = await gateIn('SER00146', 3);
    const out = async (id: number): Promise<number | null> => {
      const reply = await call({
        method: 'POST',
        url: `/api/containers/${String(id)}/exit`,
        payload: { truck: '60-22222', driver: 'أبو علي' },
      });
      expect(reply.status).toBe(200);
      return (reply.body as unknown as ContainerDto).cardOut;
    };
    expect(await out(one.id)).toBe(1);
    expect(await out(two.id)).toBe(2);

    // Taking the first exit back voids card 1 for ever.
    expect((await call({ method: 'POST', url: `/api/containers/${String(one.id)}/unexit` })).status).toBe(
      200,
    );
    const three = await gateIn('SER00159', 5);
    expect(await out(three.id)).toBe(3);
    expect((await detail(two.id)).cardOut).toBe(2);
  });
});

describe('بطاقة ملغاة — the stub that keeps the numbering whole', () => {
  it('a struck record’s serial stands in its own place, carrying nothing', async () => {
    // Three entries, the middle one struck out: its number would otherwise
    // vanish and the register would read 1, 3 — «لكي لا يختل الرقم التسلسلي».
    await gateIn('VOID0000001', 1);
    const second = (await gateIn('VOID0000002', 3)).id;
    await gateIn('VOID0000003', 5);
    await call({ method: 'DELETE', url: `/api/containers/${String(second)}` });

    const range = {
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const report = await call({
      method: 'GET',
      url: `/api/reports/gate?type=IN&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    const rows = (report.body as { rows: Array<Record<string, unknown>> }).rows;
    // Two real papers and the stub between them, in serial order.
    expect(rows.map((row) => row['card'])).toEqual([1, 2, 3]);
    expect(rows[0]?.['number']).toBe('VOID0000001');
    expect(rows[2]?.['number']).toBe('VOID0000003');

    const stub = rows[1];
    expect(stub?.['voided']).toBe(true);
    // It carries the NUMBER and nothing else — no container to open, no
    // paperwork invented, no stay counted.
    expect(stub?.['containerId']).toBe(0);
    expect(stub?.['number']).toBe('');
    expect(stub?.['bill']).toBe('');
    expect(stub?.['truck']).toBe('');
    expect(stub?.['position']).toBeNull();
    expect(stub?.['dwellDays']).toBeNull();

    // A live register is untouched by this: the other two are real rows.
    expect(rows.filter((row) => row['voided'] === true)).toHaveLength(1);
  });

  it('the exit register keeps its own holes — the owner asked for the entry cards alone', async () => {
    const one = (await gateIn('VOID0000004', 7)).id;
    const two = (await gateIn('VOID0000005', 9)).id;
    // The first exit takes card 1, is cancelled, and a second exit follows —
    // so card 1 belongs to nobody and card 2 is the next paper printed.
    await call({
      method: 'POST',
      url: `/api/containers/${String(one)}/exit`,
      payload: { truck: '60-22222', driver: '' },
    });
    await call({ method: 'POST', url: `/api/containers/${String(one)}/unexit`, payload: {} });
    await call({
      method: 'POST',
      url: `/api/containers/${String(two)}/exit`,
      payload: { truck: '60-33333', driver: '' },
    });

    const range = {
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const report = await call({
      method: 'GET',
      url: `/api/reports/gate?type=OUT&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
    });
    const rows = (report.body as { rows: Array<Record<string, unknown>> }).rows;
    // The cancelled exit is not a departure, and its voided number is NOT
    // stubbed: the exit register still shows its hole, by his own scope.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['number']).toBe('VOID0000005');
    expect(rows.some((row) => row['voided'] === true)).toBe(false);
  });
});
