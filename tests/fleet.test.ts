import { describe, expect, it } from 'vitest';
import {
  carrierOfPlate,
  findPlateDriver,
  findTruck,
  normalizePlate,
  plateLabel,
  plateMatches,
  splitPlate,
} from '../src/shared/fleet';
import type { CarrierDto, TruckDto } from '../src/shared/types';

/**
 * The plate matcher both sides trust: the gate types plates however the
 * moment allows — «60-84785»، «60 84785»، «٦٠٨٤٧٨٥»، «84785» — and every one
 * of those must name the same registered truck, or the carrier register
 * would miss trips and the autofill would stay silent.
 */

const truck = (
  id: number,
  carrierId: number,
  code: string,
  number: string,
  driver = '',
): TruckDto => ({ id, carrierId, code, number, driver });

describe('normalizePlate', () => {
  it('strips separators and case, keeps identity', () => {
    expect(normalizePlate('60-84785')).toBe('6084785');
    expect(normalizePlate('60 84785')).toBe('6084785');
    expect(normalizePlate(' 60 / 84785 ')).toBe('6084785');
    expect(normalizePlate('abc123')).toBe('ABC123');
  });

  it('folds Arabic digits to Western', () => {
    expect(normalizePlate('٦٠-٨٤٧٨٥')).toBe('6084785');
    expect(normalizePlate('۶۰۸۴۷۸۵')).toBe('6084785');
  });

  it('empty and separator-only text normalize to nothing', () => {
    expect(normalizePlate('')).toBe('');
    expect(normalizePlate(' - / ')).toBe('');
  });
});

describe('plateLabel', () => {
  it('writes the plate as the yard does: code-number', () => {
    expect(plateLabel({ code: '60', number: '84785' })).toBe('60-84785');
  });

  it('a truck without a code is its bare number', () => {
    expect(plateLabel({ code: '', number: '84785' })).toBe('84785');
  });
});

describe('plateMatches', () => {
  const registered = truck(1, 1, '60', '84785');

  it('answers for every spelling of the same plate', () => {
    expect(plateMatches(registered, '84785')).toBe(true);
    expect(plateMatches(registered, '60-84785')).toBe(true);
    expect(plateMatches(registered, '60 84785')).toBe(true);
    expect(plateMatches(registered, '6084785')).toBe(true);
    expect(plateMatches(registered, '٦٠-٨٤٧٨٥')).toBe(true);
  });

  it('refuses a different plate, an empty one, and a truck without a number', () => {
    expect(plateMatches(registered, '84786')).toBe(false);
    expect(plateMatches(registered, '')).toBe(false);
    expect(plateMatches(truck(2, 1, '60', ''), '60')).toBe(false);
  });
});

describe('findTruck', () => {
  it('a bare number finds its one truck', () => {
    const trucks = [truck(1, 1, '60', '84785'), truck(2, 1, '60', '93896')];
    expect(findTruck(trucks, '93896')?.id).toBe(2);
  });

  it('two carriers with the same number under different codes: bare is ambiguous, full decides', () => {
    const trucks = [truck(1, 1, '60', '84785'), truck(2, 2, '26', '84785')];
    expect(findTruck(trucks, '84785')).toBeNull();
    expect(findTruck(trucks, '60-84785')?.id).toBe(1);
    expect(findTruck(trucks, '26 84785')?.id).toBe(2);
  });

  it('nothing typed, nothing found', () => {
    expect(findTruck([truck(1, 1, '60', '84785')], '  ')).toBeNull();
  });
});

describe('splitPlate', () => {
  it('splits a code-number plate for the registration form', () => {
    expect(splitPlate('60-84785')).toEqual({ code: '60', number: '84785' });
    expect(splitPlate('60 84785')).toEqual({ code: '60', number: '84785' });
  });

  it('keeps anything unsplittable whole rather than guessing', () => {
    expect(splitPlate('6084785')).toEqual({ code: '', number: '6084785' });
    expect(splitPlate('ABC-12')).toEqual({ code: '', number: 'ABC-12' });
  });
});

describe('carrierOfPlate', () => {
  const carriers: CarrierDto[] = [
    { id: 1, name: 'بهاء أبو الربع' },
    { id: 2, name: 'عادل أبو غليون' },
  ];
  const trucks = [truck(1, 1, '60', '84785'), truck(2, 2, '', '5511')];

  it('names the carrier through the registered truck', () => {
    expect(carrierOfPlate(carriers, trucks, '60-84785')?.name).toBe('بهاء أبو الربع');
    expect(carrierOfPlate(carriers, trucks, '5511')?.name).toBe('عادل أبو غليون');
  });

  it('an unknown plate belongs to nobody', () => {
    expect(carrierOfPlate(carriers, trucks, '99999')).toBeNull();
  });
});

/**
 * دفتر اللوحات: «بدي مجرد ما كتبت رقم سيارته خلص يكتب اسمه تلقائي». The book
 * is keyed by the NORMALIZED plate, so however the gate spells it this time
 * it still finds what was written last time.
 */
describe('findPlateDriver', () => {
  const book = [
    { plate: '6084785', driver: 'محمد جمعه', at: '2026-09-20T08:00:00.000Z' },
    { plate: '5511', driver: 'رياض تيسير', at: '2026-09-19T08:00:00.000Z' },
  ];

  it('finds the last driver however the plate is spelled', () => {
    expect(findPlateDriver(book, '60-84785')).toBe('محمد جمعه');
    expect(findPlateDriver(book, '60 84785')).toBe('محمد جمعه');
    expect(findPlateDriver(book, '٦٠٨٤٧٨٥')).toBe('محمد جمعه');
    expect(findPlateDriver(book, '5511')).toBe('رياض تيسير');
  });

  it('says nothing about a plate it has never seen, or about nothing at all', () => {
    expect(findPlateDriver(book, '99999')).toBe('');
    expect(findPlateDriver(book, '')).toBe('');
    expect(findPlateDriver(book, '   ')).toBe('');
  });
});
