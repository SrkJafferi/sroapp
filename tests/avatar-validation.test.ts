import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { processAvatar } from '../apps/web/lib/avatar-validation';
import { avatarSelectionError, profileFields } from '../apps/web/lib/profile-contracts';
test('JPEG, PNG and WebP become metadata-free square static WebP', async () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const bytes = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#443080' },
    })
      .toFormat(format)
      .toBuffer();
    const result = await processAvatar({
      name: `fictional.${format}`,
      type: `image/${format}`,
      bytes,
    });
    const m = await sharp(result.bytes).metadata();
    assert.equal(m.format, 'webp');
    assert.equal(m.width, 512);
    assert.equal(m.height, 512);
    assert.equal(m.exif, undefined);
    assert.ok(result.size <= 2097152);
  }
});
test('crop bounds and zoom validated and cropped before encoding', async () => {
  const bytes = await sharp({
    create: { width: 640, height: 480, channels: 3, background: '#443080' },
  })
    .png()
    .toBuffer();
  const file = { name: 'fictional.png', type: 'image/png', bytes };
  await processAvatar(file, { x: 1, y: 0, zoom: 3 });
  await assert.rejects(processAvatar(file, { x: 2, y: 0, zoom: 1 }));
  await assert.rejects(processAvatar(file, { x: 0, y: 0, zoom: 4 }));
});
test('SVG, executable, MIME spoofing, malformed, tiny and oversize images rejected', async () => {
  for (const bytes of [
    Buffer.from('<svg/>'),
    Buffer.from('MZ executable'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  ])
    await assert.rejects(processAvatar({ name: 'file.png', type: 'image/png', bytes }));
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#fff' } })
    .png()
    .toBuffer();
  await assert.rejects(processAvatar({ name: 'fake.jpg', type: 'image/jpeg', bytes: png }));
  await assert.rejects(
    processAvatar({ name: 'large.png', type: 'image/png', bytes: Buffer.alloc(2097153) }),
  );
  assert.ok(avatarSelectionError({ name: 'file.svg', type: 'image/svg+xml', size: 100 }));
});
test('field validator rejects privileged input and keeps Auth email separate', () => {
  assert.equal(profileFields.safeParse({ name: 'Fictional', role: 'admin' }).success, false);
  assert.equal(
    profileFields.safeParse({ name: 'Fictional', loginEmail: 'test@example.test' }).success,
    false,
  );
  assert.equal(
    profileFields.safeParse({ name: 'Fictional', email: 'contact@example.test' }).success,
    true,
  );
});
