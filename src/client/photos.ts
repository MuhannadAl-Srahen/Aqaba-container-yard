/**
 * صور الحاوية قبل الرفع — «لو تم ادخال الكثير من الصور يصبح النظام يعلق»:
 * a phone camera original is 4–12MB; stored raw, a handful of them drags
 * the database, the backup and every thumbnail. So every picked photo is
 * downscaled HERE, before the wire — longest side capped, re-encoded JPEG —
 * and the server never sees the weight.
 */

const LONGEST = 1600;
const QUALITY = 0.82;

export async function shrinkPhoto(file: File): Promise<Blob> {
  // Already small enough to keep as it came.
  if (file.size < 300_000) return file;
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
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', QUALITY);
    });
    // Only keep the copy if it actually got lighter.
    return blob !== null && blob.size < file.size ? blob : file;
  } catch {
    // A format the browser cannot decode goes up as it came; the server
    // still enforces its own cap.
    return file;
  }
}
