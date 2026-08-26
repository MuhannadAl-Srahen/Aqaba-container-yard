/**
 * الشكوك الناعمة — تنبيه لا رفض: «الي بتقدر تحط عليه نمط لحتى الي يدخل
 * ينتبه». The gate is warned in amber and types on; the record always
 * stands, because an Iraqi plate or a hand-weighed load is real life, not
 * an error. Pure text checks — no DB, no DOM.
 */

/**
 * The yard's own traffic reads NN-NNNNN (a Jordanian plate). Anything else
 * — an Iraqi plate at the exit, or a slipped digit — deserves a second
 * look. A plate the fleet registry knows is trusted before this is asked.
 */
export function truckLooksOdd(plate: string): boolean {
  const trimmed = plate.trim();
  if (trimmed === '') return false;
  return !/^\d{2,3}-\d{4,5}$/.test(trimmed);
}

/**
 * A real gross weight lives between one and forty-five tonnes; an extra or
 * a missing zero — «احيانا بحطوا صفر زيادة» — lands far outside. Free text
 * that is not a number is left alone: the scale ticket writes what it
 * writes.
 */
export function weightLooksOdd(weight: string): boolean {
  const trimmed = weight.trim();
  if (trimmed === '') return false;
  const value = Number(trimmed.replace(/,/g, ''));
  if (!Number.isFinite(value)) return false;
  return value < 1000 || value > 45_000;
}
