import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './src/server/db';

// A backup taken under the OLD rule and then struck: 2026 entry cards 1, 2, 4
// live with 3 held by a struck-out record; permits 1 and 3 live with 2 voided.
const dir = mkdtempSync(path.join(tmpdir(), 'probe-'));
const scratch = path.join(dir, '.restore-1234.db');
const seed = openDatabase(scratch);
for (const [day, serial, deleted] of [[1,1,false],[2,2,false],[3,3,true],[4,4,false]] as const) {
  seed.prepare(
    `INSERT INTO containers (number, number_valid, size, entered_at, zone, bay, stack, tier,
                             card_in, card_in_year, deleted_at)
     VALUES (?, 1, 20, ?, 'B', 3, ?, 'A', ?, 2026, ?)`
  ).run(`HOLE000${String(serial)}`, `2026-06-0${String(day)}T09:00:00.000Z`,
        day, serial, deleted ? '2026-06-05T09:00:00.000Z' : null);
}
for (const [serial, deleted] of [[1,false],[2,true],[3,false]] as const) {
  seed.prepare(
    `INSERT INTO permits (serial, serial_year, at, bill, deleted_at) VALUES (?, 2026, ?, '3210', ?)`
  ).run(serial, `2026-06-0${String(serial)}T09:00:00.000Z`, deleted ? '2026-06-05T09:00:00.000Z' : null);
}
seed.close();

const before = new DatabaseSync(scratch, { readOnly: true });
console.log('BACKUP AS WRITTEN  containers:', JSON.stringify(before.prepare('SELECT card_in, deleted_at IS NOT NULL AS struck FROM containers ORDER BY id').all()));
console.log('BACKUP AS WRITTEN  permits   :', JSON.stringify(before.prepare('SELECT serial, deleted_at IS NOT NULL AS struck FROM permits ORDER BY id').all()));
before.close();

// EXACTLY what /api/owner/restore does to the uploaded file (ownerTools.ts:172)
const source = openDatabase(scratch);
console.log('AFTER openDatabase containers:', JSON.stringify(source.prepare('SELECT card_in, deleted_at IS NOT NULL AS struck FROM containers ORDER BY id').all()));
console.log('AFTER openDatabase permits   :', JSON.stringify(source.prepare('SELECT serial, deleted_at IS NOT NULL AS struck FROM permits ORDER BY id').all()));
source.close();
console.log('FILES LEFT IN DIR:', readdirSync(dir).join(' | '));
