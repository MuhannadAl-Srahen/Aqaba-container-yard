import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { databaseFile, snapshot } from './db';
import { sendMail } from './mailer';

/**
 * النسخة الاحتياطية الليلية — «نسخة احتياطية تلقائية ممتازة على هاد
 * البريد»: every night at 02:30 Amman the server writes its own snapshot
 * beside the live file and, when SMTP is configured, mails the file to the
 * owner's chosen inbox — a copy OFF the machine, so the yard's book
 * survives the machine. Without SMTP settings the snapshot still happens
 * and the log says the mail was skipped.
 *
 * Configuration (environment):
 *   BACKUP_SMTP_USER — the Gmail address that SENDS (app password's owner)
 *   BACKUP_SMTP_PASS — its app password
 *   BACKUP_MAIL_TO   — the inbox that receives (default: the sender)
 *   BACKUP_SMTP_HOST / BACKUP_SMTP_PORT — default smtp.gmail.com:465
 */

/** Amman is UTC+3 the whole year since 2022. */
const AMMAN_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Milliseconds from `now` until the next 02:30 Amman. Pure, testable. */
export function msUntilNightly(nowMs: number): number {
  const amman = new Date(nowMs + AMMAN_OFFSET_MS);
  const target = Date.UTC(
    amman.getUTCFullYear(),
    amman.getUTCMonth(),
    amman.getUTCDate(),
    2,
    30,
    0,
  );
  const targetMs = target - AMMAN_OFFSET_MS;
  const day = 24 * 60 * 60 * 1000;
  return targetMs > nowMs ? targetMs - nowMs : targetMs + day - nowMs;
}

/** The automatic snapshots keep two weeks of depth, then yield the disk. */
export function pruneAutos(dir: string, keep = 14): number {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.startsWith('auto-') && name.endsWith('.db'));
  } catch {
    return 0;
  }
  const dated = names
    .map((name) => ({ name, at: statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  let removed = 0;
  for (const entry of dated.slice(keep)) {
    try {
      rmSync(path.join(dir, entry.name));
      removed += 1;
    } catch {
      // A file that refuses to go tonight goes tomorrow.
    }
  }
  return removed;
}

async function runOnce(db: DatabaseSync): Promise<void> {
  if (databaseFile(db) === '') return; // memory databases have no nights
  const kept = snapshot(db, 'auto');
  pruneAutos(path.dirname(kept));
  console.log(`[nightly] snapshot ${path.basename(kept)}`);

  const user = process.env['BACKUP_SMTP_USER'] ?? '';
  const pass = process.env['BACKUP_SMTP_PASS'] ?? '';
  if (user === '' || pass === '') {
    console.log('[nightly] mail skipped — BACKUP_SMTP_USER/PASS not configured');
    return;
  }
  const to = process.env['BACKUP_MAIL_TO'] ?? user;
  const day = new Date(Date.now() + AMMAN_OFFSET_MS).toISOString().slice(0, 10);
  await sendMail({
    host: process.env['BACKUP_SMTP_HOST'] ?? 'smtp.gmail.com',
    port: Number(process.env['BACKUP_SMTP_PORT'] ?? 465),
    user,
    pass,
    to,
    subject: `نسخة ساحة العقبة الاحتياطية — ${day}`,
    text: 'النسخة الليلية الكاملة لقاعدة بيانات ساحة العقبة مرفقة بهذه الرسالة. تُحفظ الرسائل الأحدث فالأحدث؛ لاسترجاع نسخة: أدوات التدريب ← الاسترجاع.',
    attachment: { filename: path.basename(kept), content: readFileSync(kept) },
  });
  console.log(`[nightly] mailed ${path.basename(kept)} to ${to}`);
}

/** Arm the clock: fire at the next 02:30 Amman, then every night after. */
export function startNightly(db: DatabaseSync): void {
  const arm = (): void => {
    const wait = msUntilNightly(Date.now());
    setTimeout(() => {
      runOnce(db)
        .catch((error: unknown) => {
          console.error('[nightly]', error);
        })
        .finally(arm);
    }, wait).unref();
  };
  arm();
  console.log(`[nightly] armed — next run in ${String(Math.round(msUntilNightly(Date.now()) / 60000))} min`);
}
