import { describe, expect, it } from 'vitest';
import { ASEZA } from '../src/shared/asezaLayout';
import { ASEZA_681 } from './fixtures/asezaLayout681';

/**
 * The authority's newer drawing GREW the yard; it must not have moved any of
 * the old ground. Every one of the first plan's 681 slots — frozen in the
 * fixture exactly as it was committed — is still in the live layout under the
 * same zone and bay, with the very same stacks: a container standing today
 * keeps its address. tools/decode-aseza-pdf.mjs refuses to write otherwise;
 * this holds the committed file to the same word.
 */

describe('the first plan inside the newer one', () => {
  it('is the frozen 681-slot plan, A–E', () => {
    const total = ASEZA_681.zones.reduce(
      (sum, zone) => sum + zone.bays.reduce((s, bay) => s + (zone.stacks[String(bay)]?.length ?? 0), 0),
      0,
    );
    expect(total).toBe(681);
    expect(ASEZA_681.zones.map((zone) => zone.zone)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('keeps every one of its 681 slots: same zone, same yard, same bay, same stacks', () => {
    let kept = 0;
    for (const old of ASEZA_681.zones) {
      const now = ASEZA.zones.find((zone) => zone.zone === old.zone);
      expect(now, old.zone).toBeDefined();
      if (now === undefined) continue;
      expect(now.yard).toBe(old.yard);
      for (const bay of old.bays) {
        expect(now.bays, `${old.zone} bay ${String(bay)}`).toContain(bay);
        expect(now.stacks[String(bay)], `${old.zone} bay ${String(bay)}`).toEqual(old.stacks[String(bay)]);
        kept += now.stacks[String(bay)]?.length ?? 0;
      }
    }
    expect(kept).toBe(681);
  });
});
