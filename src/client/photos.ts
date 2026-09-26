/**
 * صور الحاوية قبل الرفع — «لو تم ادخال الكثير من الصور يصبح النظام يعلق»:
 * a phone camera original is 4–12MB; stored raw, a handful of them drags
 * the database, the backup and every thumbnail. So every picked photo is
 * re-encoded HERE, before the wire, and the server never sees the weight.
 *
 * «واحرص على ان تجعل الصور optimize للمساحة ولكن لا تقلل من جودتها» — so
 * the two dials that would cost quality are left exactly where they were:
 *
 *   • THE PIXELS STAY. The longest side is still capped at 1600, which is
 *     what the card, the printed sheet and any zoom actually use. Nothing
 *     that was legible before becomes less legible.
 *   • THE QUALITY TARGET STAYS at 0.82 — visually lossless for a JPEG of a
 *     container door in daylight or under a gate lamp.
 *
 * What changed is the CODEC, which costs nothing visible: WebP carries the
 * same picture in roughly two thirds of JPEG's bytes at the same quality
 * setting, because it codes flat metal and night sky far better. And the
 * early-out is gone: a 250KB phone photo used to be stored exactly as the
 * camera wrote it — EXIF, thumbnail, conservative encoder and all — and
 * that is the one place where real bytes were being kept for nothing.
 *
 * Every step is still guarded: a browser without WebP encoding falls back
 * to JPEG, and a copy that came out heavier than the original is thrown
 * away and the original sent. The picture only ever gets lighter.
 */

const LONGEST = 1600;
const QUALITY = 0.82;
/** Below this there is nothing left to win, and the re-encode may even cost. */
const FLOOR = 40_000;

/** Does this browser actually ENCODE WebP, or only decode it? Asked once. */
let webpEncodes: boolean | null = null;
function canEncodeWebp(): boolean {
  if (webpEncodes !== null) return webpEncodes;
  try {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    webpEncodes = probe.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    webpEncodes = false;
  }
  return webpEncodes;
}

export async function shrinkPhoto(file: File): Promise<Blob> {
  if (file.size < FLOOR) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, LONGEST / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (context === null) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const type = canEncodeWebp() ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, type, QUALITY);
    });
    // Only keep the copy if it actually got lighter, and only if the codec
    // it claims is the codec it used — a browser that ignored the request
    // hands back a PNG, which would be heavier anyway.
    if (blob === null || blob.size >= file.size) return file;
    return blob.type === type ? blob : file;
  } catch {
    // A format the browser cannot decode goes up as it came; the server
    // still enforces its own cap.
    return file;
  }
}
