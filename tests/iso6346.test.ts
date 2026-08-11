import { describe, expect, it } from 'vitest';
import { checkNumber, normalizeNumber } from '../src/shared/iso6346';

describe('ISO 6346 number check', () => {
  it('accepts the worked example from the standard', () => {
    // The one fixture that is not self-referential: CSQU305438 → 3.
    expect(checkNumber('CSQU3054383').valid).toBe(true);
  });

  it('rejects a wrong check digit and says what it expected', () => {
    const result = checkNumber('MSCU1234567');
    expect(result.valid).toBe(false);
    expect(result.expectedDigit).toBe(6);
  });

  it('accepts the corrected form of the same number', () => {
    expect(checkNumber('MSCU1234566').valid).toBe(true);
  });

  it('normalizes the separators people write by hand', () => {
    expect(normalizeNumber('csqu 3054-383')).toBe('CSQU3054383');
    expect(checkNumber('csqu 3054-383').valid).toBe(true);
  });

  it('rejects a category letter that is not U, J or Z', () => {
    // Same letters, category A. Check digit may coincide; category must fail it.
    const result = checkNumber('CSQA3054383');
    expect(result.valid).toBe(false);
  });

  it('cannot compute a digit for a malformed number', () => {
    expect(checkNumber('ABC').expectedDigit).toBeNull();
    expect(checkNumber('ABCDE123456').expectedDigit).toBeNull();
    expect(checkNumber('').valid).toBe(false);
  });

  /**
   * The accepted shape is four letters and seven digits, on the owner's
   * instruction. A four-and-four designation used to be waved through as «the
   * yard's own form»; it cannot carry a check digit, so it cannot be checked,
   * and it is now flagged like anything else out of shape.
   */
  it('holds every number to four letters and seven digits', () => {
    const short = checkNumber('MSCU1234');
    expect(short.wellFormed).toBe(false);
    expect(short.valid).toBe(false);
    // Still normalized and still recorded — a warning, never a refusal.
    expect(short.normalized).toBe('MSCU1234');

    for (const wrong of ['MSC1234566', 'MSCU12345', 'MSCU12345667', 'MSCUABCDEFG']) {
      expect(checkNumber(wrong).wellFormed, wrong).toBe(false);
    }
    expect(checkNumber('MSCU1234566').wellFormed).toBe(true);
  });

  it('separates being the right shape from being the right number', () => {
    // Right shape, wrong check digit: well formed, not valid.
    const typo = checkNumber('MSCU1234567');
    expect(typo.wellFormed).toBe(true);
    expect(typo.valid).toBe(false);
  });

  it('records a remainder of ten as zero', () => {
    // Brute-force a serial whose weighted sum % 11 === 10, then assert its
    // expected digit is 0 — the (sum % 11) % 10 step, proven rather than read.
    for (let serial = 0; serial < 200000; serial += 1) {
      const body = `MSCU${String(serial).padStart(6, '0')}`;
      let sum = 0;
      const values = new Map<string, number>([
        ['M', 24],
        ['S', 30],
        ['C', 13],
        ['U', 32],
      ]);
      for (let i = 0; i < 10; i += 1) {
        const ch = body[i] ?? '';
        sum += (i < 4 ? (values.get(ch) ?? 0) : Number(ch)) * 2 ** i;
      }
      if (sum % 11 === 10) {
        expect(checkNumber(`${body}0`).valid).toBe(true);
        return;
      }
    }
    throw new Error('no remainder-10 serial found in range');
  });
});
