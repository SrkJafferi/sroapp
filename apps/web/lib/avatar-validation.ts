import 'server-only';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { avatarSelectionError, MAX_AVATAR_BYTES } from './profile-contracts';
import { DocumentError } from './document-validation';
export async function processAvatar(
  file: { name: string; type: string; bytes: Uint8Array },
  crop = { x: 0.5, y: 0.5, zoom: 1 },
) {
  const error = avatarSelectionError({ ...file, size: file.bytes.length });
  if (error) throw new DocumentError(error, file.bytes.length > MAX_AVATAR_BYTES ? 413 : 415);
  if (
    ![crop.x, crop.y, crop.zoom].every(Number.isFinite) ||
    crop.x < 0 ||
    crop.x > 1 ||
    crop.y < 0 ||
    crop.y > 1 ||
    crop.zoom < 1 ||
    crop.zoom > 3
  )
    throw new DocumentError('Invalid image crop.');
  try {
    const input = Buffer.from(file.bytes);
    const meta = await sharp(input, { limitInputPixels: 25_000_000, failOn: 'warning' }).metadata();
    if (
      !meta.width ||
      !meta.height ||
      !['jpeg', 'png', 'webp'].includes(meta.format ?? '') ||
      (meta.pages ?? 1) !== 1 ||
      meta.width < 32 ||
      meta.height < 32 ||
      `image/${meta.format}` !== file.type
    )
      throw new Error('Unsupported image');
    // Decode, orient, crop and re-encode. No EXIF, names, executable suffix or source metadata survives.
    const { data, info } = await sharp(input, { limitInputPixels: 25_000_000, failOn: 'warning' })
      .rotate()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const side = Math.max(1, Math.floor(Math.min(info.width, info.height) / crop.zoom));
    const left = Math.round((info.width - side) * crop.x),
      top = Math.round((info.height - side) * crop.y);
    const bytes = await sharp(data, { raw: info })
      .extract({ left, top, width: side, height: side })
      .resize(512, 512, { fit: 'fill' })
      .webp({ quality: 85 })
      .toBuffer();
    if (bytes.length > MAX_AVATAR_BYTES) throw new Error('Processed image too large');
    return {
      bytes,
      mimeType: 'image/webp' as const,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch {
    throw new DocumentError(
      'The image is malformed, animated or unsupported. Choose a static JPEG, PNG or WebP.',
      415,
    );
  }
}
