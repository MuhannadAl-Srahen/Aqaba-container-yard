import type {
  ApiError,
  ContainerDto,
  DailyReportRow,
  ErrorCode,
  GateReportRow,
  LogReportRow,
  MeDto,
  MovementDto,
  Permission,
  Position,
  StandingReportRow,
  UserDto,
  YardStateDto,
} from '../shared/types';
import { daysBetween } from '../shared/dates';
import { AR } from './ar';

/**
 * The one place HTTP happens. Every failure becomes an ApiFailure carrying the
 * machine code and a ready Arabic sentence, so no component parses errors.
 */

export class ApiFailure extends Error {
  constructor(
    readonly code: ErrorCode | 'NETWORK',
    readonly arabic: string,
    readonly details?: Record<string, string | number>,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    // Claim a JSON body only when one is sent (null is fetch's own "no
    // body"): a bodyless POST with the JSON content-type makes the server
    // refuse the empty body it promises.
    response = await fetch(path, {
      ...init,
      ...(init?.body !== undefined &&
        init.body !== null && {
          headers: { 'content-type': 'application/json', ...init.headers },
        }),
    });
  } catch {
    throw new ApiFailure('NETWORK', AR.networkError);
  }

  if (!response.ok) {
    let body: ApiError | null = null;
    try {
      body = (await response.json()) as ApiError;
    } catch {
      // The body was not JSON; fall through to the generic failure below.
    }
    if (body !== null && typeof body.code === 'string') {
      // Refusals that involve another container carry its number, so the
      // sentence can say WHO is on top or already standing there.
      const other = body.details?.['other'];
      const arabic =
        (body.code === 'BLOCKED_DESCENT' || body.code === 'OCCUPIED') && typeof other === 'string'
          ? AR.errorWith(body.code, other)
          : (AR.errors[body.code] ?? AR.networkError);
      throw new ApiFailure(body.code, arabic, body.details);
    }
    throw new ApiFailure('NETWORK', AR.networkError);
  }

  return (await response.json()) as T;
}

export interface BootDto {
  firstRun: boolean;
  authorized: boolean;
  /** The employees the sign-in screen offers as buttons. */
  staff: Array<{ id: number; name: string }>;
}

export const api = {
  boot: (): Promise<BootDto> => request('/api/boot'),

  /** First run: the password alone — the yard IS the official layout. */
  setup: (password: string): Promise<{ ok: boolean }> =>
    request('/api/setup', { method: 'POST', body: JSON.stringify({ password }) }),

  /** The owner's door. */
  login: (password: string): Promise<{ ok: boolean }> =>
    request('/api/login', { method: 'POST', body: JSON.stringify({ password }) }),

  /** An employee's door: their name from the picker, then their PIN. */
  loginAs: (userId: number, pin: string): Promise<{ ok: boolean }> =>
    request('/api/login', { method: 'POST', body: JSON.stringify({ userId, pin }) }),

  logout: (): Promise<{ ok: boolean }> => request('/api/logout', { method: 'POST' }),

  me: (): Promise<MeDto> => request('/api/me'),

  users: (): Promise<{ users: UserDto[] }> => request('/api/users'),

  addUser: (input: {
    name: string;
    pin: string;
    permissions: readonly Permission[];
  }): Promise<UserDto> => request('/api/users', { method: 'POST', body: JSON.stringify(input) }),

  /** Send a `pin` only to replace it; leave it out to keep the current one. */
  editUser: (
    id: number,
    input: { name: string; permissions: readonly Permission[]; pin?: string },
  ): Promise<UserDto> =>
    request(`/api/users/${String(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),

  removeUser: (id: number): Promise<{ ok: boolean }> =>
    request(`/api/users/${String(id)}`, { method: 'DELETE' }),

  state: (): Promise<YardStateDto> => request('/api/state'),

  gateIn: (input: {
    number: string;
    size: 20 | 40;
    customer: string;
    bill: string;
    notes: string;
    position: Position;
    truck: string;
    seal: string;
    driver: string;
    weight: string;
    weightNet: string;
    hazmat: boolean;
  }): Promise<ContainerDto> =>
    request('/api/containers', { method: 'POST', body: JSON.stringify(input) }),

  move: (id: number, to: Position): Promise<ContainerDto> =>
    request(`/api/containers/${String(id)}/move`, {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),

  exit: (
    id: number,
    gate: { truck: string; seal: string; driver: string },
  ): Promise<ContainerDto> =>
    request(`/api/containers/${String(id)}/exit`, {
      method: 'POST',
      body: JSON.stringify(gate),
    }),

  reportGate: (type: 'IN' | 'OUT', fromIso: string, toIso: string): Promise<{ rows: GateReportRow[] }> =>
    request(
      `/api/reports/gate?type=${type}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
    ),

  reportDaily: (fromIso: string, toIso: string): Promise<{ rows: DailyReportRow[] }> =>
    request(
      `/api/reports/daily?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
    ),

  /** A snapshot of what is standing right now — no range, it is «الآن». */
  reportStanding: (): Promise<{ rows: StandingReportRow[] }> => request('/api/reports/standing'),

  reportLog: (fromIso: string, toIso: string): Promise<{ rows: LogReportRow[] }> =>
    request(
      `/api/reports/log?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
    ),

  reportTruck: (
    truck: string,
    fromIso: string,
    toIso: string,
  ): Promise<{ rows: Array<GateReportRow & { statement: 'IN' | 'OUT' }> }> =>
    request(
      `/api/reports/truck?truck=${encodeURIComponent(truck)}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
    ),

  /** كشف البوليصة: every container under one bill, standing first. */
  reportBill: (bill: string): Promise<{ rows: ContainerDto[] }> =>
    request(`/api/reports/bill?number=${encodeURIComponent(bill)}`),

  /**
   * One tap, two copies: the server writes a dated snapshot beside the live
   * file and streams the same bytes back for the browser to save.
   */
  backup: async (): Promise<{ blob: Blob; filename: string }> => {
    let response: Response;
    try {
      response = await fetch('/api/backup', { method: 'POST' });
    } catch {
      throw new ApiFailure('NETWORK', AR.networkError);
    }
    if (!response.ok) throw new ApiFailure('NETWORK', AR.networkError);
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename\*=UTF-8''([^;]+)/.exec(disposition);
    const filename = match?.[1] === undefined ? 'yard-backup.db' : decodeURIComponent(match[1]);
    return { blob: await response.blob(), filename };
  },

  /** The sheet as a server-printed PDF file. */
  reportPdf: async (title: string, html: string, landscape: boolean): Promise<Blob> => {
    let response: Response;
    try {
      response = await fetch('/api/reports/pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, html, landscape }),
      });
    } catch {
      throw new ApiFailure('NETWORK', AR.networkError);
    }
    if (!response.ok) throw new ApiFailure('NETWORK', AR.networkError);
    return response.blob();
  },

  edit: (
    id: number,
    input: { number: string; customer: string; bill: string; size: 20 | 40; notes: string },
  ): Promise<ContainerDto> =>
    request(`/api/containers/${String(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),

  remove: (id: number): Promise<{ ok: boolean }> =>
    request(`/api/containers/${String(id)}`, { method: 'DELETE' }),

  /** Undo a soft delete: the record returns, standing back if its slot allows. */
  restore: (id: number): Promise<ContainerDto> =>
    request(`/api/containers/${String(id)}/restore`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  search: (q: string): Promise<{ results: ContainerDto[] }> =>
    request(`/api/containers?q=${encodeURIComponent(q)}`),

  detail: (id: number): Promise<{ container: ContainerDto; movements: MovementDto[] }> =>
    request(`/api/containers/${String(id)}`),
};

// Latin digit order (dd/mm/yyyy) so the date never scrambles inside RTL text
// — the ar-JO date pattern carries RLM marks that visually reverse it. The
// same split sheetKit and PrintCard already use; api.ts cannot import them
// back without inverting the layering.
const dateOnlyFormat = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'short',
  timeZone: 'Asia/Amman',
});
/** 12-hour clock with the Arabic م/ص marker, Western digits. */
const timeOnlyFormat = new Intl.DateTimeFormat('ar-JO-u-nu-latn', {
  timeStyle: 'short',
  timeZone: 'Asia/Amman',
});

/** dd/mm/yyyy — render it inside a dir="ltr" element. */
export function formatDateOnly(iso: string): string {
  return dateOnlyFormat.format(new Date(iso));
}

/** h:mm م/ص — render it inside a dir="ltr" element. */
export function formatTimeOnly(iso: string): string {
  return timeOnlyFormat.format(new Date(iso));
}

/** Date then time in one run — must be rendered inside dir="ltr". */
export function formatDate(iso: string): string {
  return `${formatDateOnly(iso)}، ${formatTimeOnly(iso)}`;
}

/**
 * Calendar days in the yard. The counting itself lives in `shared/dates` so
 * the screen and the register can never disagree about what a day is.
 */
export function dwellDays(enteredAt: string, until?: string): number {
  return daysBetween(enteredAt, until ?? new Date());
}
