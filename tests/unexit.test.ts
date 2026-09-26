import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type { ContainerDto, MovementDto, Position } from '../src/shared/types';
import { toLocalStamp } from '../src/shared/dates';

/**
 * A gate is worked by a person, at night, beside a running engine — «الذي
 * يعمل عليه انسان وقد يكون الخطأ وارد». Until now a container marked out by
 * mistake was frozen: no edit, no undo, nothing but striking the record out
 * and losing its history with it. These are the two ways back.
 */

let db: DatabaseSync;
let app: FastifyInstance;
let cookie = '';

/**
 * What these tests actually read off a reply. Narrow on purpose: a test that
 * says `body.cardOut` should not compile if that field stops existing.
 */
interface ReplyBody {
  id: number;
  code: string;
  details: Record<string, string>;
  position: Position | null;
  exitedAt: string | null;
  cardIn: number | null;
  cardOut: number | null;
  cardOutYear: number | null;
  truckOut: string;
  driverOut: string;
  /** The container detail route answers with these two instead. */
  container: ContainerDto;
  movements: MovementDto[];
}

interface Reply {
  status: number;
  body: ReplyBody;
}

const call = async (options: InjectOptions): Promise<Reply> => {
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
  return { status: response.statusCode, body: body as ReplyBody };
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

const slot = (bay: number, stack: number, tier: 'A' | 'B' | 'C'): Position => ({
  zone: 'B',
  bay,
  stack,
  tier,
});

const gateIn = async (number: string, position: Position): Promise<Reply> =>
  call({
    method: 'POST',
    url: '/api/containers',
    payload: {
      number,
      size: 20,
      bill: '3210',
      notes: '',
      position,
      truck: '411',
      seal: 'JO41100',
      driver: 'أبو علي',
      weight: '28000',
      handling: 'CRANE',
    },
  });

const gateOut = async (id: number): Promise<Reply> =>
  call({
    method: 'POST',
    url: `/api/containers/${String(id)}/exit`,
    payload: { truck: '522', driver: 'أبو محمد' },
  });

const unexit = async (id: number): Promise<Reply> =>
  call({ method: 'POST', url: `/api/containers/${String(id)}/unexit`, payload: {} });

const detail = async (
  id: number,
): Promise<{ container: ContainerDto; movements: MovementDto[] }> =>
  (await call({ method: 'GET', url: `/api/containers/${String(id)}` })).body;

describe('taking an exit back', () => {
  it('stands the container in its own slot again and voids its exit card', async () => {
    const where = slot(1, 1, 'A');
    const entered = await gateIn('BACK0001', where);
    const out = await gateOut(entered.body.id);
    expect(out.status).toBe(200);
    expect(out.body.cardOut).toBe(1);

    const back = await unexit(entered.body.id);
    expect(back.status).toBe(200);
    expect(back.body.position).toEqual(where);
    expect(back.body.exitedAt).toBeNull();
    // The exit paperwork is void — it was never a departure.
    expect(back.body.cardOut).toBeNull();
    expect(back.body.cardOutYear).toBeNull();
    expect(back.body.truckOut).toBe('');
    expect(back.body.driverOut).toBe('');
    // And the entry card it came in on is untouched.
    expect(back.body.cardIn).toBe(1);
  });

  it('writes it in the log as what it is, not as a new arrival', async () => {
    const entered = await gateIn('BACK0002', slot(3, 1, 'A'));
    await gateOut(entered.body.id);
    await unexit(entered.body.id);
    const { movements } = await detail(entered.body.id);
    expect(movements.map((movement) => movement.type)).toEqual(['IN', 'OUT', 'RETURN']);
    expect(movements[2]?.to).toEqual(slot(3, 1, 'A'));
  });

  it('voids the exit serial for ever, and moves no other card', async () => {
    const first = await gateIn('BACK0003', slot(5, 1, 'A'));
    const second = await gateIn('BACK0004', slot(7, 1, 'A'));
    await gateOut(first.body.id);
    await gateOut(second.body.id);
    expect((await detail(second.body.id)).container.cardOut).toBe(2);

    // The FIRST exit was the mistake. Taking it back voids exit card 1, and
    // 1 belongs to nobody from here on — the second still reads 2, as its
    // own printed card does.
    await unexit(first.body.id);
    expect((await detail(second.body.id)).container.cardOut).toBe(2);
    // And the next departure takes 3, past the void.
    const third = await gateIn('BACK0005', slot(9, 1, 'A'));
    const out = await gateOut(third.body.id);
    expect(out.body.cardOut).toBe(3);
  });

  it('refuses when somebody has taken the slot in the meantime', async () => {
    // A stack of two: taking the bottom one out brings the top one down onto
    // the ground slot it left, so its own slot is not free any more.
    const ground = await gateIn('BACK0006', slot(11, 1, 'A'));
    const above = await gateIn('BACK0007', slot(11, 1, 'B'));
    await gateOut(ground.body.id);
    expect((await detail(above.body.id)).container.position).toEqual(slot(11, 1, 'A'));

    const back = await unexit(ground.body.id);
    expect(back.status).toBe(409);
    expect(back.body.code).toBe('OCCUPIED');
    expect(back.body.details.other).toBe('BACK0007');
    // Nothing moved: the refusal left the record exactly as it was.
    expect((await detail(ground.body.id)).container.exitedAt).not.toBeNull();
  });

  it('refuses for a container that is standing in the yard', async () => {
    const entered = await gateIn('BACK0008', slot(13, 1, 'A'));
    const back = await unexit(entered.body.id);
    expect(back.status).toBe(409);
    expect(back.body.code).toBe('NOT_EXITED');
  });

  it('lets it leave again afterwards, under a NEW number', async () => {
    const entered = await gateIn('BACK0009', slot(15, 1, 'A'));
    await gateOut(entered.body.id);
    await unexit(entered.body.id);
    const again = await gateOut(entered.body.id);
    expect(again.status).toBe(200);
    // Card 1 was printed once and voided; the second departure takes 2.
    // This used to read 1 — cancelling the newest exit dropped the count
    // and handed a number that had already been printed to another paper.
    // «قفل رقم بطاقة الخروج فلا ينزل العدّاد أبداً».
    expect(again.body.cardOut).toBe(2);
    expect(again.body.exitedAt).not.toBeNull();
  });

  it('needs the gate-out permission', async () => {
    const staff = await call({
      method: 'POST',
      url: '/api/users',
      payload: { name: 'وسام', pin: '4321', permissions: ['GATE_IN', 'EDIT'] },
    });
    const entered = await gateIn('BACK0010', slot(17, 1, 'A'));
    await gateOut(entered.body.id);
    await call({ method: 'POST', url: '/api/logout' });
    await call({
      method: 'POST',
      url: '/api/login',
      payload: { userId: staff.body.id, pin: '4321' },
    });
    const back = await unexit(entered.body.id);
    expect(back.status).toBe(403);
  });
});

/**
 * «عند التعديل على شيئ يجب ان لا يغير تاريخ دخول الحاوية في السجل» — the form
 * shows the gate date to the MINUTE, so what it hands back for a field nobody
 * touched is that minute with the seconds shaved off: a different instant
 * every single save.
 */
describe('an edit that is not about the gate date', () => {
  const editWith = async (id: number, overrides: Record<string, unknown>): Promise<Reply> => {
    const { container } = await detail(id);
    return call({
      method: 'PATCH',
      url: `/api/containers/${String(id)}`,
      payload: {
        number: container.number,
        bill: container.bill,
        size: container.size,
        notes: container.notes,
        weight: container.weight,
        handling: container.handling,
        truckIn: container.truckIn,
        driverIn: container.driverIn,
        sealIn: container.sealIn,
        truckOut: container.truckOut,
        driverOut: container.driverOut,
        enteredAt: container.enteredAt,
        exitedAt: container.exitedAt,
        ...overrides,
      },
    });
  };

  /** The instant the edit form would send back for an untouched date. */
  const asTheFormSends = (iso: string): string =>
    new Date(`${toLocalStamp(iso)}:00+03:00`).toISOString();

  it('leaves the entry instant exactly as it was, seconds and all', async () => {
    const entered = await gateIn('KEEP0001', slot(19, 1, 'A'));
    const before = (await detail(entered.body.id)).container.enteredAt;

    const saved = await editWith(entered.body.id, {
      notes: 'الباب مبعوج',
      enteredAt: asTheFormSends(before),
    });
    expect(saved.status).toBe(200);

    const { container, movements } = await detail(entered.body.id);
    expect(container.enteredAt).toBe(before);
    expect(container.notes).toBe('الباب مبعوج');
    // The IN movement was not retimed, and the log names only what changed.
    expect(movements[0]?.at).toBe(before);
    const edit = movements.find((movement) => movement.type === 'EDIT');
    expect(JSON.parse(edit?.note ?? '{}').k).toEqual(['notes']);
  });

  it('does not re-seat a single card serial', async () => {
    const first = await gateIn('KEEP0002', slot(21, 1, 'A'));
    const second = await gateIn('KEEP0003', slot(23, 1, 'A'));
    expect(second.body.cardIn).toBe(2);

    const stamp = (await detail(first.body.id)).container.enteredAt;
    await editWith(first.body.id, { weight: '31000', enteredAt: asTheFormSends(stamp) });
    expect((await detail(first.body.id)).container.cardIn).toBe(1);
    expect((await detail(second.body.id)).container.cardIn).toBe(2);
  });

  it('still moves the gate date when the office really changes it', async () => {
    const entered = await gateIn('KEEP0004', slot(25, 1, 'A'));
    const earlier = '2026-08-01T09:30:00.000Z';
    const saved = await editWith(entered.body.id, { enteredAt: earlier });
    expect(saved.status).toBe(200);

    const { container, movements } = await detail(entered.body.id);
    expect(container.enteredAt).toBe(earlier);
    // The register reads movements, so the IN movement moves with it.
    expect(movements[0]?.at).toBe(earlier);
  });
});

/**
 * «اجعل التراجع فقط عند المالك لعمليات الحذف او التعديل» — striking a record
 * out is an employee's business; reaching into the log afterwards and undoing
 * what is written there is not.
 */
describe('undoing from the log', () => {
  it('is the owner’s alone, whatever the employee’s permissions', async () => {
    const staff = await call({
      method: 'POST',
      url: '/api/users',
      payload: {
        name: 'وسام',
        pin: '4321',
        permissions: ['GATE_IN', 'GATE_OUT', 'MOVE', 'EDIT', 'DELETE', 'REPORTS'],
      },
    });
    const entered = await gateIn('UNDO0001', slot(27, 1, 'A'));
    await call({ method: 'DELETE', url: `/api/containers/${String(entered.body.id)}` });

    await call({ method: 'POST', url: '/api/logout' });
    await call({
      method: 'POST',
      url: '/api/login',
      payload: { userId: staff.body.id, pin: '4321' },
    });
    // He may delete — that is his job — and he may not undo it.
    const refused = await call({
      method: 'POST',
      url: `/api/containers/${String(entered.body.id)}/restore`,
      payload: {},
    });
    expect(refused.status).toBe(403);

    await call({ method: 'POST', url: '/api/logout' });
    await call({ method: 'POST', url: '/api/login', payload: { password: 'owner-secret-1' } });
    const allowed = await call({
      method: 'POST',
      url: `/api/containers/${String(entered.body.id)}/restore`,
      payload: {},
    });
    expect(allowed.status).toBe(200);
  });
});

describe('a cancelled exit is not a departure', () => {
  it('leaves the exit register, the daily count and the truck sheet — but not the log', async () => {
    // Found live: exit → إلغاء الخروج → exit again printed TWO rows in كشف
    // الخروج under the same exit card, and counted two departures.
    const entered = await gateIn('BACK0009', slot(9, 1, 'A'));
    await gateOut(entered.body.id);
    await unexit(entered.body.id);
    await gateOut(entered.body.id);

    const range = {
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const q = `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
    const rowsOf = async (url: string): Promise<Array<Record<string, unknown>>> =>
      ((await call({ method: 'GET', url })).body as unknown as { rows: Array<Record<string, unknown>> })
        .rows;

    const exits = await rowsOf(`/api/reports/gate?type=OUT&${q}`);
    expect(exits).toHaveLength(1);
    expect(exits[0]).toMatchObject({ number: 'BACK0009' });

    const days = await rowsOf(`/api/reports/daily?${q}`);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ inCount: 1, outCount: 1, standing: 0 });

    // Truck 522 only ever carried it OUT — one row, not two.
    expect(await rowsOf(`/api/reports/truck?truck=522&${q}`)).toHaveLength(1);

    // The history keeps every step: that is what the log is for.
    const { movements } = await detail(entered.body.id);
    expect(movements.map((movement) => movement.type)).toEqual(['IN', 'OUT', 'RETURN', 'OUT']);
  });
});

/**
 * «اريد عند الغاء الخروج ان يختار مدخل البيانات المكان الذي سوف يعيده فيها
 * لهذه الحاوية لا ارجاعها لمحلها السابق»: the yard moves on while a box is
 * out of it. Whatever rested on it came down a tier as it left, so its own
 * seat is often gone — and an hour of real work should not have to be
 * undone to take back one wrong tap.
 */
describe('إلغاء الخروج بمكان يختاره الموظف', () => {
  it('lands where the clerk names, by the same rules as any landing', async () => {
    const box = await gateIn('PICK0006', slot(3, 1, 'A'));
    await gateOut(box.body.id);

    // Its own seat is taken by the time the clerk changes his mind.
    await gateIn('TOOK0002', slot(3, 1, 'A'));
    const ownSeat = await call({
      method: 'POST',
      url: `/api/containers/${String(box.body.id)}/unexit`,
    });
    expect(ownSeat.status).toBe(409);

    // A slot of the wrong class is refused before anything moves: the bay's
    // parity IS the class, here as everywhere.
    const wrongClass = await call({
      method: 'POST',
      url: `/api/containers/${String(box.body.id)}/unexit`,
      payload: { position: slot(4, 1, 'A') },
    });
    expect(wrongClass.status).toBe(409);
    expect(wrongClass.body.code).toBe('RETURN_SIZE_CHANGED');

    // A tier with nothing under it refuses too — the rule the owner met.
    const floating = await call({
      method: 'POST',
      url: `/api/containers/${String(box.body.id)}/unexit`,
      payload: { position: slot(5, 1, 'B') },
    });
    expect(floating.status).toBe(409);

    // And the named free slot takes it, standing again where he said.
    const placed = await call({
      method: 'POST',
      url: `/api/containers/${String(box.body.id)}/unexit`,
      payload: { position: slot(5, 1, 'A') },
    });
    expect(placed.status).toBe(200);
    expect(placed.body.position).toMatchObject({ zone: 'B', bay: 5, stack: 1, tier: 'A' });
    expect(placed.body.exitedAt).toBeNull();
    // The exit card is voided exactly as it is on the plain return.
    expect(placed.body.cardOut).toBeNull();

    const { movements } = await detail(box.body.id);
    expect(movements.map((movement) => movement.type)).toEqual(['IN', 'OUT', 'RETURN']);
    expect(movements[2]?.to).toMatchObject({ bay: 5, stack: 1, tier: 'A' });
  });
});
