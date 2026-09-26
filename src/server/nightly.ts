import { copyFileSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
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
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * «فقط خذ كل يومين»: every second day, not every night. The chosen days are
 * the EVEN ones counted from the epoch in Amman time, so the rhythm is a
 * property of the calendar rather than of when the service last restarted —
 * a machine rebooted at noon does not quietly reset the cycle or take two
 * copies in a row.
 */
export const BACKUP_EVERY_DAYS = 2;

/** Milliseconds from `now` until the next 02:30 Amman that falls on a backup day. */
export function msUntilNightly(nowMs: number, everyDays: number = BACKUP_EVERY_DAYS): number {
  const amman = new Date(nowMs + AMMAN_OFFSET_MS);
  const target = Date.UTC(
    amman.getUTCFullYear(),
    amman.getUTCMonth(),
    amman.getUTCDate(),
    2,
    30,
    0,
  );
  let targetMs = target - AMMAN_OFFSET_MS;
  if (targetMs <= nowMs) targetMs += DAY_MS;
  // Walk forward to the next day the cycle owns. One day at a time, so a
  // cycle of one behaves exactly as the nightly job always did.
  while (Math.floor((targetMs + AMMAN_OFFSET_MS) / DAY_MS) % everyDays !== 0) {
    targetMs += DAY_MS;
  }
  return targetMs - nowMs;
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

/**
 * الدفتر بلا صور — what actually fits in an email. The full snapshot is
 * 582 MB, of which the photos are 99%; Gmail stops at 25 MB and the base64
 * of the whole file would burst the process before it ever got there. So
 * the mail carries the LEDGER: a COPY of tonight's snapshot with the photo
 * rows dropped and the file vacuumed down, gzipped — about one megabyte.
 *
 * Nothing live is touched. The delete happens inside a throwaway copy that
 * is removed the moment its bytes are read; the full snapshot beside it
 * keeps every photo, and the yard's own database is never opened here.
 */
function mailableLedger(snapshotPath: string): { filename: string; content: Buffer } {
  const scratch = `${snapshotPath.replace(/\.db$/, '')}-ledger.db`;
  copyFileSync(snapshotPath, scratch);
  try {
    const copy = new DatabaseSync(scratch);
    try {
      copy.exec('PRAGMA foreign_keys = OFF');
      copy.exec('DELETE FROM photos');
      copy.exec('VACUUM');
    } finally {
      copy.close();
    }
    return {
      filename: `${path.basename(scratch)}.gz`,
      content: gzipSync(readFileSync(scratch)),
    };
  } finally {
    rmSync(scratch, { force: true });
  }
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
  const ledger = mailableLedger(kept);
  console.log(`[nightly] ledger ${ledger.filename} — ${String(ledger.content.length)} bytes`);
  await sendMail({
    host: process.env['BACKUP_SMTP_HOST'] ?? 'smtp.gmail.com',
    port: Number(process.env['BACKUP_SMTP_PORT'] ?? 465),
    user,
    pass,
    to,
    subject: `نسخة ساحة العقبة الاحتياطية — ${day}`,
    // The one thing this sentence must never let happen: restoring this
    // copy while believing it complete. It says what is inside and what
    // is not, in the first line and again at the end.
    text:
      'دفتر ساحة العقبة الاحتياطي مرفق بهذه الرسالة، مضغوطاً.\n\n' +
      'يحوي كل شيء: الحاويات والحركات والتصاريح والبطاقات والمهام والأجور ' +
      'والدفعات والمستخدمين.\n\n' +
      'ولا يحوي صور الحاويات — وحدها — لأن حجمها يمنع إرسالها بالبريد. ' +
      'الصور محفوظة كاملةً في النسخة التي على الخادم.\n\n' +
      'للاسترجاع: فكّ الضغط عن الملف (gz.) ثم: أدوات المالك ← الاسترجاع. ' +
      'وانتبه: استرجاع هذا الملف يعيد الدفتر كاملاً بلا الصور.',
    attachment: ledger,
  });
  console.log(`[nightly] mailed ${ledger.filename} to ${to}`);
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
