import type {
  ApiError,
  BlockConfig,
  ContainerDto,
  DailyReportRow,
  ErrorCode,
  GateReportRow,
  LogReportRow,
  MovementDto,
  Position,
  YardConfig,
  YardStateDto,
} from '../shared/types';
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
      const by = body.details?.['by'];
      const arabic =
        typeof by === 'string'
          ? AR.errorWithBy(body.code, by)
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
  yardConfigured: boolean;
}

/** The first-run shape: two halves the server lays out for the owner. */
export interface SetupShape {
  twenty: { rows: number; cols: number };
  forty: { rows: number; cols: number };
}

/** A layout block on its way to the server: existing keep ids, new ones have none. */
export type BlockDraft = Omit<BlockConfig, 'id'> & { readonly id?: number };

export const api = {
  boot: (): Promise<BootDto> => request('/api/boot'),

  setup: (password: string, yard: SetupShape): Promise<{ ok: boolean }> =>
    request('/api/setup', { method: 'POST', body: JSON.stringify({ password, yard }) }),

  saveYard: (blocks: readonly BlockDraft[]): Promise<YardConfig> =>
    request('/api/yard', { method: 'PUT', body: JSON.stringify({ blocks }) }),

  login: (password: string): Promise<{ ok: boolean }> =>
    request('/api/login', { method: 'POST', body: JSON.stringify({ password }) }),

  logout: (): Promise<{ ok: boolean }> => request('/api/logout', { method: 'POST' }),

  state: (): Promise<YardStateDto> => request('/api/state'),

  gateIn: (input: {
    number: string;
    size: 20 | 40;
    customer: string;
    cargo: 'EMPTY' | 'LADEN';
    notes: string;
    position: Position;
    truck: string;
    driver: string;
    weight: string;
  }): Promise<ContainerDto> =>
    request('/api/containers', { method: 'POST', body: JSON.stringify(input) }),

  move: (id: number, to: Position): Promise<ContainerDto> =>
    request(`/api/containers/${String(id)}/move`, {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),

  exit: (id: number, gate: { truck: string; driver: string }): Promise<ContainerDto> =>
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

  /** DEVELOPMENT ONLY: wipe containers, movements and card counters. */
  devReset: (): Promise<{ ok: boolean }> =>
    request('/api/dev/reset', { method: 'POST', body: JSON.stringify({}) }),

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
    input: {
      number: string;
      customer: string;
      cargo: 'EMPTY' | 'LADEN';
      size: 20 | 40;
      notes: string;
    },
  ): Promise<ContainerDto> =>
    request(`/api/containers/${String(id)}`, { method: 'PATCH', body: JSON.stringify(input) }),

  remove: (id: number): Promise<{ ok: boolean }> =>
    request(`/api/containers/${String(id)}`, { method: 'DELETE' }),

  search: (q: string): Promise<{ results: ContainerDto[] }> =>
    request(`/api/containers?q=${encodeURIComponent(q)}`),

  detail: (id: number): Promise<{ container: ContainerDto; movements: MovementDto[] }> =>
    request(`/api/containers/${String(id)}`),
};

const dateFormat = new Intl.DateTimeFormat('ar-JO-u-nu-latn', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Amman',
});

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function dwellDays(enteredAt: string, until?: string): number {
  const end = until === undefined ? Date.now() : new Date(until).getTime();
  const days = Math.floor((end - new Date(enteredAt).getTime()) / 86_400_000);
  return Math.max(0, days);
}
