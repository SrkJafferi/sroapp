export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_BUCKET = 'clinic-medical-documents';
export const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export function documentSelectionError(file: { name: string; type: string; size: number }) {
  if (!file.size || file.size > MAX_DOCUMENT_BYTES) return 'Choose a non-empty file up to 10 MB.';
  if (file.name.length > 250 || /[\\/\x00-\x1f\x7f]/.test(file.name))
    return 'Choose a file with a valid filename.';
  const extension = file.name.split('.').pop()?.toLowerCase();
  const expected =
    extension === 'pdf'
      ? 'application/pdf'
      : ['jpg', 'jpeg'].includes(extension ?? '')
        ? 'image/jpeg'
        : extension === 'png'
          ? 'image/png'
          : '';
  if (!expected || file.type !== expected)
    return 'Choose a PDF, JPG, JPEG or PNG with a matching file type.';
  return null;
}
export function documentSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}
