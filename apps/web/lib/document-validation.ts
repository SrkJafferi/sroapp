import 'server-only';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { PDFDocument, PDFDict, PDFArray, PDFName, PDFStream, PDFObject } from 'pdf-lib';
import { documentSelectionError, MAX_DOCUMENT_BYTES } from './document-rules';

export class DocumentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
const blockedPdfNames = new Set([
  'JavaScript',
  'JS',
  'OpenAction',
  'AA',
  'Launch',
  'EmbeddedFile',
  'EmbeddedFiles',
  'Filespec',
  'RichMedia',
  'XFA',
  'AcroForm',
  'URI',
  'SubmitForm',
  'ImportData',
  'GoToR',
  'GoToE',
  'Sound',
  'Movie',
  'Rendition',
]);

function completeImageBoundary(bytes: Buffer, format: 'png' | 'jpeg') {
  if (format === 'png') {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
      offset += 12 + length;
      if (offset > bytes.length) throw new Error('Truncated PNG');
      if (type === 'IEND') {
        if (length !== 0 || offset !== bytes.length) throw new Error('PNG suffix');
        return;
      }
    }
    throw new Error('Missing PNG end');
  }
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw new Error('JPEG marker');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (offset !== bytes.length) throw new Error('JPEG suffix');
      return;
    }
    if (offset + 2 > bytes.length) throw new Error('Truncated JPEG');
    const length = bytes.readUInt16BE(offset);
    if (length < 2) throw new Error('JPEG segment');
    offset += length;
    if (marker === 0xda || marker === 0xdc) {
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        const next = bytes[offset + 1];
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) {
          offset += 2;
          continue;
        }
        break;
      }
    }
  }
  throw new Error('Missing JPEG end');
}

export async function validateMedicalFile(input: {
  name: string;
  type: string;
  bytes: Uint8Array;
}) {
  const selectionError = documentSelectionError({
    name: input.name,
    type: input.type,
    size: input.bytes.byteLength,
  });
  if (selectionError)
    throw new DocumentError(
      selectionError,
      input.bytes.byteLength > MAX_DOCUMENT_BYTES ? 413 : 415,
    );
  const bytes = Buffer.from(input.bytes);
  try {
    if (input.type === 'application/pdf') {
      if (
        bytes.subarray(0, 5).toString('ascii') !== '%PDF-' ||
        !/%%EOF\s*$/.test(bytes.subarray(-1024).toString('latin1'))
      )
        throw new Error('Invalid PDF boundaries');
      const pdf = await PDFDocument.load(bytes, {
        ignoreEncryption: false,
        updateMetadata: false,
        throwOnInvalidObject: true,
      });
      if (pdf.getPageCount() < 1 || pdf.getPageCount() > 200) throw new Error('PDF page limit');
      const seen = new Set<PDFObject>();
      const inspect = (object: PDFObject, depth = 0) => {
        if (depth > 64) throw new Error('PDF nesting limit');
        if (seen.has(object)) return;
        seen.add(object);
        if (object instanceof PDFName && blockedPdfNames.has(object.decodeText()))
          throw new Error('Interactive PDF');
        if (object instanceof PDFDict)
          for (const [key, value] of object.entries()) {
            inspect(key, depth + 1);
            inspect(value, depth + 1);
          }
        if (object instanceof PDFArray)
          for (const value of object.asArray()) inspect(value, depth + 1);
        if (object instanceof PDFStream) inspect(object.dict, depth + 1);
      };
      for (const [, object] of pdf.context.enumerateIndirectObjects()) inspect(object);
      // Preserve accepted PDF bytes. Interactive/encrypted PDFs are refused.
    } else {
      const image = sharp(bytes, {
        limitInputPixels: 25_000_000,
        failOn: 'warning',
        animated: false,
      });
      const metadata = await image.metadata();
      const format = input.type === 'image/png' ? 'png' : 'jpeg';
      if (metadata.format !== format || (metadata.pages ?? 1) !== 1)
        throw new Error('Image format mismatch');
      completeImageBoundary(bytes, format);
      // Decode fully for validity, without changing medical pixels or original bytes.
      await image.raw().toBuffer();
    }
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    throw new DocumentError(
      'This file could not be verified. Use a static, unencrypted PDF (up to 200 pages) or single JPG/PNG (up to 25 megapixels), without active content or embedded files.',
      415,
    );
  }
  return {
    bytes,
    name: input.name,
    mimeType: input.type,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
