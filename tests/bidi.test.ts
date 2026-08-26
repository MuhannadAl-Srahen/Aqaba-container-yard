import { describe, expect, it } from 'vitest';
import { AR } from '../src/client/ar';

/**
 * اتجاه الترميز: a Latin code inside an Arabic sentence must still read from
 * the left. Measured in a real browser inside `dir="rtl"`, the plate
 * `60-45165` displays as `45165-60` and the address `2-B-32-01-B` displays as
 * `B-32-01-B-2` — the hyphen splits the code and the pieces are then laid out
 * right to left. The owner caught it: «اتاكد من الترميز بيجي من الشمال مو من
 * اليمين يعني 60-85745 وهكذا».
 *
 * The cure is two unprintable characters — U+2066 LEFT-TO-RIGHT ISOLATE and
 * U+2069 POP DIRECTIONAL ISOLATE — around the code inside the sentence
 * itself, which is the only place that also reaches confirm dialogs, toasts
 * and printed headings, none of which can carry markup.
 *
 * Slash-separated codes (`0035/2026`) and unbroken ones (`ASLU5008663`) were
 * measured to render correctly on their own and are deliberately not wrapped.
 */

const LRI = '⁦';
const PDI = '⁩';

/** The code, wrapped exactly as a correct sentence must wrap it. */
const isolated = (code: string): string => `${LRI}${code}${PDI}`;

const PLATE = '60-45165';
const SLOT = '2-B-32-01-B';
const BOX = 'ASLU5008663';

describe('اتجاه الترميز داخل الجملة العربية', () => {
  const cases: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ['driverByTruck', AR.driverByTruck(PLATE), [PLATE]],
    ['driverOfTruck', AR.driverOfTruck(PLATE), [PLATE]],
    ['truckWithDriver', AR.truckWithDriver(PLATE, 'أبو خالد'), [PLATE]],
    ['truckManyDrivers (2)', AR.truckManyDrivers(PLATE, 2), [PLATE]],
    ['truckManyDrivers (5)', AR.truckManyDrivers(PLATE, 5), [PLATE]],
    ['driversPrintTitleTruck', AR.driversPrintTitleTruck(PLATE), [PLATE]],
    ['confirmTruckDeleteBody', AR.confirmTruckDeleteBody(PLATE), [PLATE]],
    ['gateInDone', AR.gateInDone(BOX, SLOT), [BOX, SLOT]],
    ['unexitDone', AR.unexitDone(BOX, SLOT), [BOX, SLOT]],
    ['confirmUnexitBody', AR.confirmUnexitBody(BOX, SLOT), [BOX, SLOT]],
    ['confirmDeleteBody', AR.confirmDeleteBody(BOX), [BOX]],
  ];

  for (const [name, sentence, codes] of cases) {
    it(`${name} يعزل ترميزه فيُقرأ من اليسار`, () => {
      for (const code of codes) {
        expect(sentence).toContain(isolated(code));
      }
      // The isolates are balanced: one PDI closes each LRI, or the rest of
      // the sentence inherits the wrong direction from the code.
      expect(sentence.split(LRI).length).toBe(sentence.split(PDI).length);
    });
  }

  it('لا يُغيَّر النص المرئي، إنما اتجاه قراءته', () => {
    const bare = AR.driverByTruck(PLATE).replaceAll(LRI, '').replaceAll(PDI, '');
    expect(bare).toBe(`سيارة ${PLATE} — بلا اسم سائق`);
  });

  /**
   * The isolates belong to the SENTENCE, never to a value that is stored,
   * compared or searched — a plate carrying an invisible character would stop
   * matching the same plate typed at the gate.
   */
  it('حروف العزل لا تدخل قيمة تُقارَن', () => {
    const label = AR.driverByTruck(PLATE);
    expect(label.includes(PLATE)).toBe(true);
    expect(PLATE).not.toContain(LRI);
    expect(PLATE).not.toContain(PDI);
  });
});
