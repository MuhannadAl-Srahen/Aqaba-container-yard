import type { CardSheetRow } from '../shared/types';
import { positionLabel } from '../shared/address';
import { plainCode } from '../shared/bidi';
import { AR } from './ar';
import { api } from './api';
import { downloadBlob } from './sheetKit';

/**
 * الطباعة الكلية للبطاقات — «بدي طريقة اطبع جميع بطاقات الدخول مره واحدة
 * وجميع بطاقات الخروج مره واحدة مهما كان عددها فقط تحت صلاحية المالك».
 *
 * The server hands the FACTS of every card in the range (its own
 * owner-guarded route), and this file writes the Arabic book around them:
 * one standalone HTML document, a page per card in serial order, printed to
 * PDF by the server's browser — the same press the registers already use.
 * Built as strings, not JSX, for the same reason `sheetHtml` is: the
 * document leaves the app and must carry everything it needs inside itself.
 *
 * The card mirrors the single `PrintCard` paper: the voucher strip (serial,
 * title, day/date/time), the receipt statement on entry cards, the hero
 * container number, the labelled grid, the two signature boxes — and, when
 * the owner asks, each entry card's photos as the pages behind it.
 */

export type CardKind = 'in' | 'out' | 'move';

/** What a MOVE movement's note carries when the lift brought others down. */
interface DropNote {
  readonly n: string;
  readonly f: string;
  readonly t: string;
}

function dropsOf(note: string): readonly DropNote[] {
  if (note === '') return [];
  try {
    const parsed = JSON.parse(note) as { d?: DropNote[] };
    return Array.isArray(parsed.d) ? parsed.d : [];
  } catch {
    return [];
  }
}

const dayFormat = new Intl.DateTimeFormat('ar-JO', { weekday: 'long', timeZone: 'Asia/Amman' });
// Latin digit order (dd/mm/yyyy) so the date never scrambles inside RTL text.
const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeZone: 'Asia/Amman' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: 'Asia/Amman' });

const esc = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** One labelled cell of the voucher grid — the string twin of PrintCard's row. */
const row = (
  label: string,
  value: string,
  options: { mono?: boolean; wide?: boolean; ltr?: boolean } = {},
): string => {
  const classes = [
    'row',
    options.wide === true ? 'wide' : '',
    options.mono === true ? 'mono' : options.ltr === true ? 'ltr' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<div class="${classes}"><span class="lbl">${esc(label)}</span><span class="val">${value}</span></div>`;
};

const titleOf = (kind: CardKind): string =>
  kind === 'move' ? AR.cardMoveTitle : kind === 'in' ? AR.cardInTitle : AR.cardOutTitle;

function cardSection(kind: CardKind, card: CardSheetRow): string {
  const at = new Date(card.at);
  const serialText = card.serial === null ? '—' : String(card.serial).padStart(4, '0');
  const dash = (value: string): string => (value === '' ? '—' : esc(value));

  const rows: string[] = [];
  if (kind === 'move') {
    rows.push(
      row(AR.cardFrom, card.from === null ? '—' : positionLabel(card.from), { mono: true }),
      row(AR.cardTo, card.to === null ? '—' : positionLabel(card.to), { mono: true }),
    );
  }
  rows.push(row(AR.cardBill, dash(card.bill), { mono: true }), row(AR.cardSize, AR.feet(card.size)));
  if (kind !== 'move') {
    rows.push(row(AR.cardSlot, card.slot === null ? '—' : positionLabel(card.slot), { mono: true }));
  }
  rows.push(row(AR.cardWeight, dash(card.weight), { ltr: true }));
  if (kind === 'in') {
    rows.push(
      row(AR.cardHandling, card.handling === null ? '—' : (AR.handlingName[card.handling] ?? '—')),
    );
  }
  rows.push(
    row(AR.cardSeal, dash(card.seal), { mono: true }),
    row(AR.cardStoredAt, dateFormat.format(new Date(card.enteredAt)), { ltr: true }),
  );
  if (kind !== 'move') {
    rows.push(row(AR.cardTruck, dash(card.truck), { ltr: true }), row(AR.cardDriver, dash(card.driver)));
  }
  // The hand that did the paperwork, on the entry card exactly as the single
  // card prints it — the bulk book and the one paper must never disagree.
  if (kind === 'in') rows.push(row(AR.cardUser, dash(card.user)));
  rows.push(row(AR.cardNotes, dash(card.notes), { wide: true }));
  const drops = kind === 'move' ? dropsOf(card.note) : [];
  if (drops.length > 0) {
    const lines = drops
      .map(
        (drop) =>
          `<span class="dropline"><span class="code">${esc(drop.n)}</span> ${esc(AR.dropFrom)} ` +
          `<span class="code">${esc(drop.f)}</span> ${esc(AR.dropTo)} <span class="code">${esc(drop.t)}</span></span>`,
      )
      .join('');
    rows.push(row(AR.cardDrops, lines, { wide: true }));
  }

  return (
    `<section class="card">` +
    `<div class="strip">` +
    `<div class="serial"><span class="slbl">${esc(AR.cardNumber)}</span>` +
    `<span class="snum">${esc(serialText)}</span>` +
    (card.serialYear === null ? '' : `<span class="syear">${String(card.serialYear)}</span>`) +
    `</div>` +
    `<div class="title">${esc(titleOf(kind))}</div>` +
    `<div class="stamp"><span class="slbl">${esc(kind === 'move' ? AR.cardMovedAt : AR.cardIssuedAt)}</span>` +
    `<span class="sday">${esc(dayFormat.format(at))}</span>` +
    `<span class="sdate">${esc(dateFormat.format(at))}</span>` +
    `<span class="sdate">${esc(timeFormat.format(at))}</span></div>` +
    `</div>` +
    (kind === 'in' ? `<p class="statement">${esc(AR.cardStatement)}</p>` : '') +
    `<div class="hero"><p class="hlbl">${esc(AR.containerNumber)}</p><p class="hnum">${esc(card.number)}</p></div>` +
    `<div class="grid">${rows.join('')}</div>` +
    `<div class="signs"><div>${esc(AR.cardWorkerSign)}</div><div>${esc(AR.cardSupervisorSign)}</div></div>` +
    `</section>`
  );
}

/**
 * The whole book. `photoPages` maps a container id to its photos as data
 * URIs — the server's browser opens the document with no session and no
 * origin, so a relative photo URL would print as a broken square; the ink
 * must travel inside the document.
 */
export function cardsBookHtml(
  kind: CardKind,
  cards: readonly CardSheetRow[],
  photoPages: ReadonlyMap<number, readonly string[]>,
): string {
  const sections = cards
    .flatMap((card) => {
      const photos = kind === 'in' ? (photoPages.get(card.containerId) ?? []) : [];
      const photoSection =
        photos.length === 0
          ? []
          : [
              `<section class="photos"><p class="ptitle">${esc(AR.photosOnPaper(card.number))}</p>` +
                photos.map((uri) => `<img src="${uri}" alt="">`).join('') +
                `</section>`,
            ];
      return [cardSection(kind, card), ...photoSection];
    })
    .join('');

  return (
    `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>` +
    `*{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}` +
    // The server machine has Noto Naskh, installed by the setup script; Cairo
    // leads only for a book opened on the office machine itself.
    `body{font-family:'Cairo','Noto Naskh Arabic','Noto Sans Arabic','Segoe UI',Tahoma,sans-serif;` +
    `margin:0;color:#0f172a;font-variant-numeric:lining-nums}` +
    // Every section is one sheet of the book; only the first opens no page.
    `section{break-before:page;page-break-before:always}` +
    `section:first-child{break-before:auto;page-break-before:auto}` +
    `.card{border:2px solid #334155;border-radius:8px;overflow:hidden}` +
    `.strip{display:flex;align-items:stretch;border-bottom:2px solid #334155}` +
    `.serial{width:110px;border-inline-end:1px solid #334155;padding:8px 6px;text-align:center}` +
    `.slbl{display:block;font-size:10px;color:#64748b;font-weight:600}` +
    `.snum{display:inline-block;direction:ltr;border:1px solid #334155;border-radius:6px;` +
    `padding:0 8px;font-family:ui-monospace,Consolas,monospace;font-size:22px;font-weight:800;margin-top:2px}` +
    `.syear{display:block;direction:ltr;font-size:10px;font-weight:700;color:#64748b}` +
    `.title{flex:1;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800}` +
    `.stamp{width:150px;border-inline-start:1px solid #334155;padding:8px 10px;font-size:12px}` +
    `.sday{display:block;font-weight:700}` +
    `.sdate{display:block;direction:ltr;text-align:right;color:#475569}` +
    `.statement{border-bottom:2px solid #334155;margin:0;padding:10px 12px;font-size:13px;font-weight:600;line-height:1.9}` +
    `.hero{border-bottom:2px solid #334155;padding:8px;text-align:center}` +
    `.hlbl{margin:0;font-size:10px;font-weight:700;color:#64748b}` +
    `.hnum{margin:0;direction:ltr;font-family:ui-monospace,Consolas,monospace;font-size:26px;` +
    `font-weight:800;letter-spacing:.12em}` +
    `.grid{display:grid;grid-template-columns:1fr 1fr}` +
    `.row{display:flex;align-items:stretch;border-bottom:1px solid #94a3b8;min-height:34px}` +
    `.row:nth-child(odd){border-inline-end:1px solid #94a3b8}` +
    `.row.wide{grid-column:1/-1;border-inline-end:0}` +
    `.lbl{width:105px;flex:none;display:flex;align-items:center;background:#e2e8f0;` +
    `border-inline-end:1px solid #94a3b8;padding:4px 8px;font-size:12px;font-weight:700}` +
    `.val{flex:1;min-width:0;display:flex;align-items:center;padding:4px 8px;font-size:13px;` +
    `font-weight:600;line-height:1.7;overflow-wrap:anywhere}` +
    `.mono .val{direction:ltr;justify-content:flex-end;font-family:ui-monospace,Consolas,monospace;letter-spacing:.04em}` +
    `.ltr .val{direction:ltr;justify-content:flex-end}` +
    `.dropline{display:block}` +
    `.code{direction:ltr;unicode-bidi:isolate;white-space:nowrap;font-family:ui-monospace,Consolas,monospace;font-weight:700}` +
    `.signs{display:flex;border-top:2px solid #334155}` +
    `.signs div{flex:1;height:80px;padding:8px;font-size:12px;font-weight:700;color:#64748b}` +
    `.signs div:first-child{border-inline-end:1px solid #94a3b8}` +
    `.photos{text-align:center}` +
    `.ptitle{font-size:13px;font-weight:700;margin:0 0 10px}` +
    `.photos img{display:block;margin:0 auto 10px;max-width:100%;max-height:150mm;` +
    `border:1px solid #94a3b8;border-radius:6px;break-inside:avoid}` +
    `</style></head><body>` +
    sections +
    `</body></html>`
  );
}

/** A photo fetched with the session and folded into the document itself. */
async function photoAsDataUri(id: number): Promise<string | null> {
  try {
    const response = await fetch(`/api/photos/${String(id)}`);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(typeof reader.result === 'string' ? reader.result : null);
      };
      reader.onerror = () => {
        resolve(null);
      };
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * The whole flow: rows from the owner's route, photos folded in when asked,
 * the book pressed to PDF on the server, the file handed to the browser.
 * Returns how many cards the book carries — 0 means the range held none and
 * nothing was downloaded.
 */
export async function downloadCardsBook(
  kind: CardKind,
  fromIso: string,
  toIso: string,
  withPhotos: boolean,
  title: string,
): Promise<number> {
  const { rows } = await api.cardRows(kind, fromIso, toIso);
  if (rows.length === 0) return 0;

  const photoPages = new Map<number, readonly string[]>();
  if (kind === 'in' && withPhotos) {
    for (const card of rows) {
      if (card.photoIds.length === 0 || photoPages.has(card.containerId)) continue;
      const uris = await Promise.all(card.photoIds.map(photoAsDataUri));
      const loaded = uris.filter((uri): uri is string => uri !== null);
      if (loaded.length > 0) photoPages.set(card.containerId, loaded);
    }
  }

  const html = cardsBookHtml(kind, rows, photoPages);
  const blob = await api.cardsPdf(title, html);
  downloadBlob(blob, `${plainCode(title)}.pdf`);
  return rows.length;
}
