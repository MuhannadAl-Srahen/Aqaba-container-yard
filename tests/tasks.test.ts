import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db';
import { buildApp } from '../src/server/app';
import type { ContainerDto, Handling, Permission, Position, TaskDto } from '../src/shared/types';

/**
 * مهام الآليات: the WhatsApp photo group, replaced. The gate acts and the
 * right machine's tablet is told; the driver answers «تم»; the desk watches,
 * hurries, and re-routes. These tests are the feature's contract.
 */

let db: DatabaseSync;
let app: FastifyInstance;
let ownerCookie: string;

const at = (bay: number, stack: number): Position => ({ zone: 'B', bay, stack, tier: 'A' });

const cookieOf = (headers: Record<string, unknown>): string => {
  const raw = headers['set-cookie'];
  const header = Array.isArray(raw) ? raw[0] : (raw as string | undefined);
  if (header === undefined) throw new Error('no session cookie');
  return header.split(';')[0] ?? '';
};

async function call(options: {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  payload?: unknown;
  cookie?: string;
}): Promise<{ status: number; body: unknown }> {
  const response = await app.inject({
    method: options.method,
    url: options.url,
    ...(options.payload === undefined ? {} : { payload: options.payload as object }),
    headers: options.cookie === undefined ? {} : { cookie: options.cookie },
  });
  return {
    status: response.statusCode,
    body: response.body === '' ? null : (JSON.parse(response.body) as unknown),
  };
}

/** Create an account (office or driver) and sign in as them. */
async function hire(
  name: string,
  pin: string,
  permissions: readonly Permission[],
  machine: Handling | '' = '',
): Promise<{ id: number; cookie: string }> {
  const made = await call({
    method: 'POST',
    url: '/api/users',
    payload: { name, pin, permissions, machine },
    cookie: ownerCookie,
  });
  if (made.status !== 201) throw new Error(`hire failed: ${JSON.stringify(made.body)}`);
  const id = (made.body as { id: number }).id;
  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { userId: id, pin },
  });
  if (login.statusCode !== 200) throw new Error('sign-in failed');
  return { id, cookie: cookieOf(login.headers as Record<string, unknown>) };
}

const gateInPayload = (
  number: string,
  position: Position,
  handling: Handling = 'CRANE',
): Record<string, unknown> => ({
  number,
  size: 20,
  bill: '3210',
  notes: '',
  position,
  truck: '500',
  seal: 'JO100001',
  driver: 'أبو أحمد',
  weight: '25000',
  handling,
});

/** Gate a container in as the owner; returns its id. */
async function receive(
  number: string,
  position: Position,
  handling: Handling = 'CRANE',
): Promise<number> {
  const made = await call({
    method: 'POST',
    url: '/api/containers',
    payload: gateInPayload(number, position, handling),
    cookie: ownerCookie,
  });
  if (made.status !== 201) throw new Error(`gate-in failed: ${JSON.stringify(made.body)}`);
  return (made.body as { id: number }).id;
}

async function tasksOf(
  cookie: string,
  query = '',
): Promise<readonly TaskDto[]> {
  const answer = await call({ method: 'GET', url: `/api/tasks${query}`, cookie });
  if (answer.status !== 200) throw new Error(`tasks failed: ${JSON.stringify(answer.body)}`);
  return (answer.body as { tasks: TaskDto[] }).tasks;
}

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp(db);
  await app.ready();
  const response = await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { password: 'yard-secret' },
  });
  if (response.statusCode !== 200) throw new Error('setup failed');
  ownerCookie = cookieOf(response.headers as Record<string, unknown>);
});

describe('birth at the gate', () => {
  it('gating in tells the chosen machine, and only its own driver sees it', async () => {
    const craneDriver = await hire('سائق الونش', '1111', ['MOVE'], 'CRANE');
    const straddleDriver = await hire('سائق العقرب', '2222', ['MOVE'], 'STRADDLE');
    await receive('TGHU1234565', at(1, 1), 'CRANE');

    const craneList = await tasksOf(craneDriver.cookie);
    expect(craneList).toHaveLength(1);
    expect(craneList[0]?.kind).toBe('IN');
    expect(craneList[0]?.machine).toBe('CRANE');
    expect(craneList[0]?.number).toBe('TGHU1234565');
    expect(craneList[0]?.position).toEqual(at(1, 1));
    // «ضع الوزن ايضا عند المهام» — the machine must know what it lifts.
    expect(craneList[0]?.weight).toBe('25000');
    expect(craneList[0]?.status).toBe('PENDING');

    // The straddle's tablet stays quiet — even asking for the crane's list
    // is answered with their own.
    expect(await tasksOf(straddleDriver.cookie)).toHaveLength(0);
    expect(await tasksOf(straddleDriver.cookie, '?machine=CRANE')).toHaveLength(0);
  });

  it('«تم»: the driver closes it under their name; the wrong machine may not', async () => {
    const craneDriver = await hire('سائق الونش', '1111', [], 'CRANE');
    const straddleDriver = await hire('سائق العقرب', '2222', [], 'STRADDLE');
    await receive('TGHU1234565', at(1, 1), 'CRANE');
    const task = (await tasksOf(craneDriver.cookie))[0];
    if (task === undefined) throw new Error('no task');

    const wrong = await call({
      method: 'POST',
      url: `/api/tasks/${String(task.id)}/done`,
      payload: {},
      cookie: straddleDriver.cookie,
    });
    expect(wrong.status).toBe(403);

    const done = await call({
      method: 'POST',
      url: `/api/tasks/${String(task.id)}/done`,
      payload: {},
      cookie: craneDriver.cookie,
    });
    expect(done.status).toBe(200);
    expect((done.body as TaskDto).status).toBe('DONE');
    expect((done.body as TaskDto).doneBy).toBe('سائق الونش');
    expect((done.body as TaskDto).closedNote).toBe('');

    // Closed is closed: a second «تم» tells the screen it is behind.
    const again = await call({
      method: 'POST',
      url: `/api/tasks/${String(task.id)}/done`,
      payload: {},
      cookie: craneDriver.cookie,
    });
    expect(again.status).toBe(409);
    expect((again.body as { code: string }).code).toBe('TASK_CLOSED');
  });
});

describe('تجهيز — the prepare request', () => {
  it('defaults to what unloaded the box; an explicit machine wins', async () => {
    const clerk = await hire('كاتب', '3333', ['GATE_IN', 'GATE_OUT']);
    const one = await receive('TGHU1234565', at(1, 1), 'CRANE');
    const two = await receive('MSKU1234565', at(3, 1), 'CRANE');

    const defaulted = await call({
      method: 'POST',
      url: '/api/tasks/prepare',
      payload: { containerId: one },
      cookie: clerk.cookie,
    });
    expect(defaulted.status).toBe(201);
    expect((defaulted.body as TaskDto).machine).toBe('CRANE');
    expect((defaulted.body as TaskDto).kind).toBe('OUT');

    const overridden = await call({
      method: 'POST',
      url: '/api/tasks/prepare',
      payload: { containerId: two, machine: 'STRADDLE' },
      cookie: clerk.cookie,
    });
    expect(overridden.status).toBe(201);
    expect((overridden.body as TaskDto).machine).toBe('STRADDLE');
  });

  it('one pending تجهيز per container; the departed and the missing refuse', async () => {
    const clerk = await hire('كاتب', '3333', ['GATE_OUT']);
    const id = await receive('TGHU1234565', at(1, 1));
    const first = await call({
      method: 'POST',
      url: '/api/tasks/prepare',
      payload: { containerId: id },
      cookie: clerk.cookie,
    });
    expect(first.status).toBe(201);

    const twin = await call({
      method: 'POST',
      url: '/api/tasks/prepare',
      payload: { containerId: id },
      cookie: clerk.cookie,
    });
    expect(twin.status).toBe(409);
    expect((twin.body as { code: string }).code).toBe('TASK_EXISTS');

    const missing = await call({
      method: 'POST',
      url: '/api/tasks/prepare',
      payload: { containerId: 9999 },
      cookie: clerk.cookie,
    });
    expect(missing.status).toBe(404);

    const noPerm = await hire('ناظر', '4444', ['REPORTS']);
    const refused = await call({
      method: 'POST',
      url: '/api/tasks/prepare',
      payload: { containerId: id },
      cookie: noPerm.cookie,
    });
    expect(refused.status).toBe(403);
  });

  it('a whole bill at once: one task per standing box, pending ones skipped', async () => {
    const clerk = await hire('كاتب', '3333', ['GATE_OUT']);
    await receive('TGHU1234565', at(1, 1), 'CRANE');
    const second = await receive('MSKU1234565', at(3, 1), 'STRADDLE');
    await call({
      method: 'POST',
      url: '/api/tasks/prepare',
      payload: { containerId: second },
      cookie: clerk.cookie,
    });

    const batch = await call({
      method: 'POST',
      url: '/api/tasks/prepare-bill',
      payload: { bill: '3210' },
      cookie: clerk.cookie,
    });
    expect(batch.status).toBe(201);
    expect(batch.body).toEqual({ created: 1, skipped: 1 });

    // «حسب آلية كل حاوية»: each task went to its own machine.
    const all = await tasksOf(ownerCookie, '?status=PENDING');
    const out = all.filter((task) => task.kind === 'OUT');
    expect(out.map((task) => task.machine).sort()).toEqual(['CRANE', 'STRADDLE']);

    const repeat = await call({
      method: 'POST',
      url: '/api/tasks/prepare-bill',
      payload: { bill: '3210' },
      cookie: clerk.cookie,
    });
    expect(repeat.body).toEqual({ created: 0, skipped: 2 });

    const empty = await call({
      method: 'POST',
      url: '/api/tasks/prepare-bill',
      payload: { bill: 'NO-SUCH-BILL' },
      cookie: clerk.cookie,
    });
    expect(empty.status).toBe(404);
  });
});

describe('the exit and the queue', () => {
  it('recording the exit answers the pending تجهيز and births nothing extra', async () => {
    const clerk = await hire('كاتب', '3333', ['GATE_OUT']);
    const id = await receive('TGHU1234565', at(1, 1));
    await call({
      method: 'POST',
      url: '/api/tasks/prepare',
      payload: { containerId: id },
      cookie: clerk.cookie,
    });

    const exit = await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/exit`,
      payload: { truck: '600', driver: '' },
      cookie: clerk.cookie,
    });
    expect(exit.status).toBe(200);

    expect(await tasksOf(ownerCookie, '?status=PENDING')).toHaveLength(0);
    const done = await tasksOf(ownerCookie, '?status=DONE');
    const closed = done.filter((task) => task.kind === 'OUT');
    expect(closed).toHaveLength(1);
    expect(closed[0]?.closedNote).toBe('AUTO_EXIT');
    expect(closed[0]?.doneBy).toBe('كاتب');
  });

  it('an exit with no تجهيز before it births the task right there, slot and truck kept', async () => {
    const id = await receive('TGHU1234565', at(5, 2), 'STRADDLE');
    // The driver finished stacking it long ago.
    const entry = (await tasksOf(ownerCookie, '?status=PENDING'))[0];
    if (entry === undefined) throw new Error('no entry task');
    await call({
      method: 'POST',
      url: `/api/tasks/${String(entry.id)}/done`,
      payload: {},
      cookie: ownerCookie,
    });

    const exit = await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/exit`,
      payload: { truck: '77-123', driver: 'خليل' },
      cookie: ownerCookie,
    });
    expect(exit.status).toBe(200);

    const pending = await tasksOf(ownerCookie, '?status=PENDING');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.kind).toBe('OUT');
    expect(pending[0]?.machine).toBe('STRADDLE');
    expect(pending[0]?.truck).toBe('77-123');
    // The live position is wiped by the exit; the task still names the slot.
    expect(pending[0]?.position).toEqual(at(5, 2));
  });

  it('a legacy container with no machine on record exits without a task', async () => {
    const id = await receive('TGHU1234565', at(1, 1));
    const entry = (await tasksOf(ownerCookie, '?status=PENDING'))[0];
    if (entry === undefined) throw new Error('no entry task');
    await call({
      method: 'POST',
      url: `/api/tasks/${String(entry.id)}/done`,
      payload: {},
      cookie: ownerCookie,
    });
    // The ten pre-v14 rows: no machine was ever recorded.
    db.prepare(`UPDATE containers SET handling = '' WHERE id = ?`).run(id);

    const exit = await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/exit`,
      payload: { truck: '600', driver: '' },
      cookie: ownerCookie,
    });
    expect(exit.status).toBe(200);
    expect(await tasksOf(ownerCookie, '?status=PENDING')).toHaveLength(0);
  });

  it('the exit names the machine that will load the truck, not the one that unloaded it', async () => {
    // «ليس دائما التي ادخلتها هي نفسها التي سوف تخرجها» — the straddle
    // stacked it, the crane is the one free when the truck comes.
    const id = await receive('TGHU1234565', at(3, 2), 'STRADDLE');
    const entry = (await tasksOf(ownerCookie, '?status=PENDING'))[0];
    if (entry === undefined) throw new Error('no entry task');
    await call({
      method: 'POST',
      url: `/api/tasks/${String(entry.id)}/done`,
      payload: {},
      cookie: ownerCookie,
    });

    const exit = await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/exit`,
      payload: { truck: '77-500', driver: 'سامر', machine: 'CRANE' },
      cookie: ownerCookie,
    });
    expect(exit.status).toBe(200);

    const pending = await tasksOf(ownerCookie, '?status=PENDING');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.kind).toBe('OUT');
    expect(pending[0]?.machine).toBe('CRANE');
    // المناولة is what unloaded the box at entry, and the entry card prints
    // it: choosing a machine for the departure may never rewrite history.
    expect((exit.body as ContainerDto).handling).toBe('STRADDLE');
  });

  it('a container with no machine on record still routes, once the clerk names one', async () => {
    const id = await receive('TGHU1234565', at(7, 1));
    const entry = (await tasksOf(ownerCookie, '?status=PENDING'))[0];
    if (entry === undefined) throw new Error('no entry task');
    await call({
      method: 'POST',
      url: `/api/tasks/${String(entry.id)}/done`,
      payload: {},
      cookie: ownerCookie,
    });
    db.prepare(`UPDATE containers SET handling = '' WHERE id = ?`).run(id);

    const exit = await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/exit`,
      payload: { truck: '601', driver: '', machine: 'STRADDLE' },
      cookie: ownerCookie,
    });
    expect(exit.status).toBe(200);
    const pending = await tasksOf(ownerCookie, '?status=PENDING');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.machine).toBe('STRADDLE');
  });

  it('undoing an exit voids its unfinished task; deleting a record closes all', async () => {
    const id = await receive('TGHU1234565', at(1, 1));
    await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/exit`,
      payload: { truck: '600', driver: '' },
      cookie: ownerCookie,
    });
    const undone = await call({
      method: 'POST',
      url: `/api/containers/${String(id)}/unexit`,
      payload: {},
      cookie: ownerCookie,
    });
    expect(undone.status).toBe(200);
    expect(await tasksOf(ownerCookie, '?status=PENDING')).toHaveLength(0);
    const returned = (await tasksOf(ownerCookie, '?status=DONE')).find(
      (task) => task.kind === 'OUT',
    );
    expect(returned?.closedNote).toBe('AUTO_RETURN');

    const second = await receive('MSKU1234565', at(3, 1));
    const removed = await call({
      method: 'DELETE',
      url: `/api/containers/${String(second)}`,
      cookie: ownerCookie,
    });
    expect(removed.status).toBe(200);
    const struck = (await tasksOf(ownerCookie, '?status=DONE')).find(
      (task) => task.containerId === second,
    );
    expect(struck?.closedNote).toBe('AUTO_DELETE');
  });
});

describe('the desk runs the queue', () => {
  it('«مستعجل» jumps the line; otherwise the oldest goes first', async () => {
    await hire('سائق الونش', '1111', [], 'CRANE');
    await receive('TGHU1234565', at(1, 1), 'CRANE');
    await receive('MSKU1234565', at(3, 1), 'CRANE');
    await receive('TRLU1234560', at(5, 1), 'CRANE');

    const before = await tasksOf(ownerCookie, '?machine=CRANE');
    expect(before.map((task) => task.number)).toEqual([
      'TGHU1234565',
      'MSKU1234565',
      'TRLU1234560',
    ]);

    const last = before[2];
    if (last === undefined) throw new Error('no third task');
    const hurried = await call({
      method: 'POST',
      url: `/api/tasks/${String(last.id)}/urgent`,
      payload: { urgent: true },
      cookie: ownerCookie,
    });
    expect(hurried.status).toBe(200);

    const after = await tasksOf(ownerCookie, '?machine=CRANE');
    expect(after.map((task) => task.number)).toEqual([
      'TRLU1234560',
      'TGHU1234565',
      'MSKU1234565',
    ]);
    expect(after[0]?.urgent).toBe(true);
  });

  it('re-routing an IN task corrects the recorded machine and says so in the log', async () => {
    const clerk = await hire('كاتب', '3333', ['GATE_IN']);
    const id = await receive('TGHU1234565', at(1, 1), 'CRANE');
    const task = (await tasksOf(ownerCookie))[0];
    if (task === undefined) throw new Error('no task');

    const moved = await call({
      method: 'POST',
      url: `/api/tasks/${String(task.id)}/machine`,
      payload: { machine: 'STRADDLE' },
      cookie: clerk.cookie,
    });
    expect(moved.status).toBe(200);
    expect((moved.body as TaskDto).machine).toBe('STRADDLE');

    const detail = await call({
      method: 'GET',
      url: `/api/containers/${String(id)}`,
      cookie: ownerCookie,
    });
    const container = (detail.body as { container: { handling: string } }).container;
    expect(container.handling).toBe('STRADDLE');
    const movements = (detail.body as { movements: Array<{ type: string; note: string }> })
      .movements;
    const edit = movements.find((movement) => movement.type === 'EDIT');
    expect(edit?.note).toContain('handling');
  });

  it('re-routing an OUT task moves the task alone; drivers may not re-route', async () => {
    const clerk = await hire('كاتب', '3333', ['GATE_OUT']);
    const driver = await hire('سائق الونش', '1111', [], 'CRANE');
    const id = await receive('TGHU1234565', at(1, 1), 'CRANE');
    const entry = (await tasksOf(ownerCookie))[0];
    if (entry === undefined) throw new Error('no entry task');
    await call({
      method: 'POST',
      url: `/api/tasks/${String(entry.id)}/done`,
      payload: {},
      cookie: ownerCookie,
    });
    const prepared = await call({
      method: 'POST',
      url: '/api/tasks/prepare',
      payload: { containerId: id },
      cookie: clerk.cookie,
    });
    const outTask = prepared.body as TaskDto;

    const byDriver = await call({
      method: 'POST',
      url: `/api/tasks/${String(outTask.id)}/machine`,
      payload: { machine: 'STRADDLE' },
      cookie: driver.cookie,
    });
    expect(byDriver.status).toBe(403);

    const byClerk = await call({
      method: 'POST',
      url: `/api/tasks/${String(outTask.id)}/machine`,
      payload: { machine: 'STRADDLE' },
      cookie: clerk.cookie,
    });
    expect(byClerk.status).toBe(200);

    const detail = await call({
      method: 'GET',
      url: `/api/containers/${String(id)}`,
      cookie: ownerCookie,
    });
    expect((detail.body as { container: { handling: string } }).container.handling).toBe('CRANE');
  });

  it('the queue answers the desks and registers; a bare account is refused', async () => {
    await receive('TGHU1234565', at(1, 1));
    const watcher = await hire('ناظر', '4444', ['REPORTS']);
    expect(await tasksOf(watcher.cookie)).toHaveLength(1);

    const bare = await hire('ضيف', '5555', []);
    const refused = await call({ method: 'GET', url: '/api/tasks', cookie: bare.cookie });
    expect(refused.status).toBe(403);
  });
});

describe('accounts and sessions', () => {
  it('machine rides the user routes and /api/me, and stays off the boot staff', async () => {
    const driver = await hire('سائق العقرب', '2222', ['MOVE'], 'STRADDLE');

    const list = await call({ method: 'GET', url: '/api/users', cookie: ownerCookie });
    const users = (list.body as { users: Array<{ id: number; machine: string }> }).users;
    expect(users.find((user) => user.id === driver.id)?.machine).toBe('STRADDLE');

    const me = await call({ method: 'GET', url: '/api/me', cookie: driver.cookie });
    expect((me.body as { machine: string }).machine).toBe('STRADDLE');

    const patched = await call({
      method: 'PATCH',
      url: `/api/users/${String(driver.id)}`,
      payload: { name: 'سائق العقرب', permissions: ['MOVE'], machine: '' },
      cookie: ownerCookie,
    });
    expect((patched.body as { machine: string }).machine).toBe('');

    const boot = await call({ method: 'GET', url: '/api/boot', cookie: driver.cookie });
    const staff = (boot.body as { staff: Array<Record<string, unknown>> }).staff;
    expect(staff.every((row) => !('machine' in row))).toBe(true);
  });

  it('boot flags the caller’s own driverhood, and the shift session is long', async () => {
    const driver = await hire('سائق الونش', '1111', [], 'CRANE');
    const clerk = await hire('كاتب', '3333', ['GATE_IN']);

    const asDriver = await call({ method: 'GET', url: '/api/boot', cookie: driver.cookie });
    expect((asDriver.body as { driver: boolean }).driver).toBe(true);
    const asClerk = await call({ method: 'GET', url: '/api/boot', cookie: clerk.cookie });
    expect((asClerk.body as { driver: boolean }).driver).toBe(false);
    const anonymous = await call({ method: 'GET', url: '/api/boot' });
    expect((anonymous.body as { driver: boolean }).driver).toBe(false);

    // The token's middle segment is the expiry: a shift for the driver, the
    // office hour for the clerk.
    const horizonOf = (cookie: string): number => {
      const token = cookie.split('=')[1] ?? '';
      return Number(token.split('.')[1] ?? 0) - Date.now();
    };
    expect(horizonOf(driver.cookie)).toBeGreaterThan(11 * 60 * 60 * 1000);
    expect(horizonOf(clerk.cookie)).toBeLessThan(2 * 60 * 60 * 1000);
  });
});

describe('«تحديد الكل ثم تم» — the desk closes many at once', () => {
  it('closes every pending task chosen, skips the closed and the unknown, refuses a driver', async () => {
    const clerk = await hire('مدخل البيانات', '3333', ['GATE_IN'], '');
    const driver = await hire('سائق الونش', '1111', ['MOVE'], 'CRANE');
    await receive('TGHU1234565', at(1, 1), 'CRANE');
    await receive('MSKU7654325', at(3, 1), 'CRANE');
    await receive('TRLU5566770', at(5, 1), 'CRANE');
    const queue = await tasksOf(driver.cookie);
    expect(queue).toHaveLength(3);
    const ids = queue.map((task) => task.id);
    // The driver already finished one by hand.
    await call({
      method: 'POST',
      url: `/api/tasks/${String(ids[0])}/done`,
      payload: {},
      cookie: driver.cookie,
    });

    // A driver may not sweep the queue; and nothing chosen is nothing asked.
    const refused = await call({
      method: 'POST',
      url: '/api/tasks/done-many',
      payload: { ids },
      cookie: driver.cookie,
    });
    expect(refused.status).toBe(403);
    const empty = await call({
      method: 'POST',
      url: '/api/tasks/done-many',
      payload: { ids: [] },
      cookie: clerk.cookie,
    });
    expect(empty.status).toBe(400);

    // The desk sweeps: two still pending close, the finished one and a
    // stranger are skipped and counted — never refused.
    const swept = await call({
      method: 'POST',
      url: '/api/tasks/done-many',
      payload: { ids: [...ids, 999_999] },
      cookie: clerk.cookie,
    });
    expect(swept.status).toBe(200);
    expect(swept.body).toEqual({ done: 2, skipped: 2 });
    expect(await tasksOf(driver.cookie)).toHaveLength(0);
    const done = await tasksOf(clerk.cookie, '?status=DONE');
    expect(done.filter((task) => task.doneBy === 'مدخل البيانات')).toHaveLength(2);
  });
});

describe('نداء إدخال شاحنة — الآلية تنادي البوابة', () => {
  it('the driver calls once, the gate answers, and a second press is the same truck', async () => {
    const driver = await hire('سائق العقرب', '2222', ['MOVE'], 'STRADDLE');
    const clerk = await hire('مدخل البيانات', '3333', ['GATE_IN'], '');
    const accounting = await hire('محاسب', '4444', ['ACCOUNTING'], '');

    // Only a machine account may call — an office hand has nobody to call.
    expect(
      (await call({ method: 'POST', url: '/api/gate-calls', payload: {}, cookie: clerk.cookie }))
        .status,
    ).toBe(403);

    const made = await call({
      method: 'POST',
      url: '/api/gate-calls',
      payload: {},
      cookie: driver.cookie,
    });
    expect(made.status).toBe(201);
    const id = (made.body as { id: number }).id;
    expect((made.body as { machine: string }).machine).toBe('STRADDLE');
    expect((made.body as { by: string }).by).toBe('سائق العقرب');

    // Pressed again while it stands: the same call, not a second truck.
    const again = await call({
      method: 'POST',
      url: '/api/gate-calls',
      payload: {},
      cookie: driver.cookie,
    });
    expect((again.body as { id: number }).id).toBe(id);

    // The gate sees it; a clerk with neither gate nor task rights does not.
    const seen = await call({ method: 'GET', url: '/api/gate-calls', cookie: clerk.cookie });
    expect((seen.body as { calls: unknown[] }).calls).toHaveLength(1);
    expect(
      (await call({ method: 'GET', url: '/api/gate-calls', cookie: accounting.cookie })).status,
    ).toBe(403);

    // Answered by the hand that recorded the truck, and it goes out.
    const answered = await call({
      method: 'POST',
      url: `/api/gate-calls/${String(id)}/done`,
      payload: {},
      cookie: clerk.cookie,
    });
    expect(answered.status).toBe(200);
    expect((answered.body as { status: string }).status).toBe('DONE');
    expect((answered.body as { doneBy: string }).doneBy).toBe('مدخل البيانات');
    expect(
      ((await call({ method: 'GET', url: '/api/gate-calls', cookie: clerk.cookie })).body as {
        calls: unknown[];
      }).calls,
    ).toHaveLength(0);

    // Answering twice tells the screen it is behind; and now the driver may
    // call again, because the truck he called about has been recorded.
    const twice = await call({
      method: 'POST',
      url: `/api/gate-calls/${String(id)}/done`,
      payload: {},
      cookie: clerk.cookie,
    });
    expect(twice.status).toBe(409);
    const fresh = await call({
      method: 'POST',
      url: '/api/gate-calls',
      payload: {},
      cookie: driver.cookie,
    });
    expect((fresh.body as { id: number }).id).not.toBe(id);

    // A driver sees only his own machine's calls.
    const crane = await hire('سائق الونش', '1111', [], 'CRANE');
    expect(
      ((await call({ method: 'GET', url: '/api/gate-calls', cookie: crane.cookie })).body as {
        calls: unknown[];
      }).calls,
    ).toHaveLength(0);
  });
});
