import 'server-only';
import { Upload } from 'tus-js-client';
import { DocumentError } from './document-validation';
import { DOCUMENT_BUCKET } from './document-rules';

export async function resumableDocumentUpload(
  bytes: Buffer,
  objectKey: string,
  mimeType: string,
  accessToken: string,
) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      void upload.abort();
      reject(new DocumentError('Secure transfer timed out. Retry the upload.', 503));
    }, 90_000);
    const upload = new Upload(bytes, {
      endpoint: 'https://jyigxpjvygvtvcypujel.storage.supabase.co/storage/v1/upload/resumable',
      headers: { authorization: `Bearer ${accessToken}` },
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      storeFingerprintForResuming: false,
      removeFingerprintOnSuccess: true,
      retryDelays: [0, 1000, 3000],
      metadata: {
        bucketName: DOCUMENT_BUCKET,
        objectName: objectKey,
        contentType: mimeType,
        cacheControl: '0',
      },
      onError() {
        clearTimeout(timer);
        reject(new DocumentError('Secure transfer failed. Retry the upload.', 503));
      },
      onSuccess() {
        clearTimeout(timer);
        resolve();
      },
    });
    upload.start();
  });
}
