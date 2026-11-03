import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { validateMedicalFile } from '../apps/web/lib/document-validation';
import { documentSelectionError, MAX_DOCUMENT_BYTES } from '../apps/web/lib/document-rules';
async function pdf() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return doc;
}
test('accepted static PDF bytes are preserved exactly', async () => {
  const bytes = await (await pdf()).save();
  const result = await validateMedicalFile({
    name: 'Fictional report.pdf',
    type: 'application/pdf',
    bytes,
  });
  assert.deepEqual(result.bytes, Buffer.from(bytes));
  assert.equal(result.sha256.length, 64);
});
test('actual PNG and JPEG bytes are preserved; executable tails are rejected', async () => {
  for (const type of ['png', 'jpeg'] as const) {
    const valid = await sharp({
      create: { width: 20, height: 20, channels: 3, background: '#ffffff' },
    })
      .toFormat(type)
      .toBuffer();
    const bytes = Buffer.concat([valid, Buffer.from('MZ_EXECUTABLE_TAIL')]);
    const result = await validateMedicalFile({
      name: `Fictional.${type}`,
      type: `image/${type}`,
      bytes: valid,
    });
    assert.deepEqual(result.bytes, valid);
    assert.equal((await sharp(result.bytes).metadata()).format, type);
    await assert.rejects(
      validateMedicalFile({ name: `Fictional.${type}`, type: `image/${type}`, bytes }),
    );
  }
});
test('progressive JPEG and embedded image metadata preserve original bytes', async () => {
  const bytes = await sharp({
    create: { width: 40, height: 30, channels: 3, background: '#ffffff' },
  })
    .withMetadata()
    .jpeg({ progressive: true })
    .toBuffer();
  const result = await validateMedicalFile({ name: 'scan.jpg', type: 'image/jpeg', bytes });
  assert.deepEqual(result.bytes, bytes);
});
test('invalid MIME, extension, empty file, path traversal and oversized input are refused', async () => {
  assert.ok(documentSelectionError({ name: 'report.pdf.exe', type: 'application/pdf', size: 50 }));
  assert.ok(documentSelectionError({ name: '../report.pdf', type: 'application/pdf', size: 50 }));
  assert.ok(documentSelectionError({ name: 'report.pdf', type: 'application/pdf', size: 0 }));
  await assert.rejects(
    validateMedicalFile({
      name: 'report.pdf',
      type: 'application/pdf',
      bytes: new Uint8Array(MAX_DOCUMENT_BYTES + 1),
    }),
    (e) => (e as { status: number }).status === 413,
  );
});
test('spoofed PDF, JPEG, PNG and executable contents are rejected', async () => {
  for (const [name, type] of [
    ['report.pdf', 'application/pdf'],
    ['report.png', 'image/png'],
    ['report.jpg', 'image/jpeg'],
  ])
    await assert.rejects(
      validateMedicalFile({
        name,
        type,
        bytes: Buffer.from('MZ executable <html>not an image</html>'),
      }),
      (e) => (e as { status: number }).status === 415,
    );
});
test('active/embedded/externally launching PDF content is refused including compressed objects', async () => {
  for (const key of ['OpenAction', 'AA', 'EmbeddedFiles', 'JavaScript', 'URI']) {
    const document = await pdf();
    document.catalog.set(PDFName.of(key), PDFString.of('unsafe'));
    await assert.rejects(
      validateMedicalFile({
        name: 'report.pdf',
        type: 'application/pdf',
        bytes: await document.save({ useObjectStreams: true }),
      }),
      (e) => (e as { status: number }).status === 415,
    );
  }
});
test('PDF executable suffix and malformed/truncated structures are rejected', async () => {
  const bytes = await (await pdf()).save();
  await assert.rejects(
    validateMedicalFile({
      name: 'report.pdf',
      type: 'application/pdf',
      bytes: Buffer.concat([bytes, Buffer.from('MZ_EXECUTABLE')]),
    }),
  );
  await assert.rejects(
    validateMedicalFile({
      name: 'report.pdf',
      type: 'application/pdf',
      bytes: bytes.subarray(0, 80),
    }),
  );
});
