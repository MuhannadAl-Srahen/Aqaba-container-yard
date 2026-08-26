/**
 * اتجاه الترميز داخل نص عربي.
 *
 * Measured in a real browser inside `dir="rtl"`, by the visual x-position of
 * every character rather than by reading the string — which returns logical
 * order and reports success either way:
 *
 *     سيارة 60-45165 نهاية      displays as   سيارة 45165-60 نهاية
 *     الخانة 2-B-32-01-B نهاية   displays as   الخانة B-32-01-B-2 نهاية
 *     سيارة 60/45165 نهاية      displays correctly
 *     الحاوية ASLU5008663       displays correctly
 *
 * It is the HYPHEN. Arabic text cuts a hyphenated code at its hyphens and
 * lays the pieces out right to left. Every plate in the fleet is hyphenated
 * (`60-45165`) and so is every address in the yard (`2-B-32-01-B`), which is
 * what the owner caught: «اتاكد من الترميز بيجي من الشمال مو من اليمين».
 *
 * These live in `shared` because both sides need them: the client wraps codes
 * into Arabic sentences, and the server strips the wrapping back out when it
 * turns a sheet's title into a download's filename.
 */

/** LEFT-TO-RIGHT ISOLATE — opens a run that reads from the left. */
const LRI = '⁦';
/** POP DIRECTIONAL ISOLATE — closes it. */
const PDI = '⁩';

/**
 * Wrap a Latin code so it reads from the left wherever the sentence is shown.
 *
 * Two unprintable characters, which is the point: the same sentence becomes a
 * confirm dialog, a toast, a printed heading and a line of PDF, and not one of
 * those can carry an HTML tag. `<bdi dir="ltr">` fixes only the ones that are
 * JSX.
 *
 * NEVER put the result anywhere it will be stored, compared, sorted or
 * searched. A plate carrying an invisible character stops matching the same
 * plate typed at the gate, and the fleet register matches plates by text.
 */
export const ltrCode = (code: string): string => `${LRI}${code}${PDI}`;

/**
 * Strip the isolates back out — for a FILENAME, or anywhere a machine reads
 * the text instead of a person. A file called `كشف السيارة ⁦60-45165⁩.pdf`
 * carries two characters nobody can see or type.
 */
export const plainCode = (text: string): string => text.replace(/[⁦-⁩]/g, '');
