'use client';
import { useEffect, useRef, useState } from 'react';
import { FileText, Upload, Download, ExternalLink, CircleAlert } from 'lucide-react';
import { useClinic } from './clinic-context';
import { Button, Empty } from './ui';
import { documentSelectionError, documentSize } from '@/lib/document-rules';

export function MedicalDocuments({ patientId }: { patientId: string }) {
  const { role, organizationId, branchId, state, refresh } = useClinic();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<'report' | 'handwritten'>('report');
  const [requestId, setRequestId] = useState('');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saved, setSaved] = useState(false);
  const xhr = useRef<XMLHttpRequest | null>(null);
  const submitting = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      xhr.current?.abort();
    },
    [],
  );
  const documents = state.documents.filter((d) => d.patientId === patientId);
  const choose = (selected: File | null) => {
    setError('');
    setSuccess('');
    setSaved(false);
    setProgress(0);
    setRequestId(crypto.randomUUID());
    if (!selected) {
      setFile(null);
      return;
    }
    const invalid = documentSelectionError(selected);
    if (invalid) {
      setError(invalid);
      setFile(null);
      return;
    }
    setFile(selected);
  };
  const upload = async () => {
    if (!file || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      if (!saved) {
        setProgress(0);
        const form = new FormData();
        form.set('file', file);
        form.set('organizationId', organizationId);
        form.set('patientId', patientId);
        form.set('branchId', branchId);
        form.set('kind', kind);
        form.set('requestId', requestId);
        await new Promise<void>((resolve, reject) => {
          const transfer = new XMLHttpRequest();
          xhr.current = transfer;
          transfer.open('POST', '/api/medical-documents');
          transfer.timeout = 120_000;
          transfer.upload.onprogress = (e) => {
            if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
          };
          transfer.onerror = () =>
            reject(new Error('The connection failed. Retry the same selection.'));
          transfer.ontimeout = () =>
            reject(new Error('The upload timed out. Retry the same selection.'));
          transfer.onabort = () =>
            reject(new Error('The upload was interrupted. Retry the same selection.'));
          transfer.onload = () => {
            if ([401, 403].includes(transfer.status)) void refresh().catch(() => {});
            try {
              const response = JSON.parse(transfer.responseText);
              if (transfer.status >= 200 && transfer.status < 300 && response.saved && response.id)
                resolve();
              else reject(new Error(response.error ?? 'The document could not be saved.'));
            } catch {
              reject(new Error('The document could not be saved. Retry the same selection.'));
            }
          };
          transfer.send(form);
        });
        setSaved(true);
        setProgress(100);
      }
      await refresh();
      setSuccess('Document uploaded securely and added to the patient record.');
      setFile(null);
      if (input.current) input.current.value = '';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The upload failed. Please retry.');
    } finally {
      submitting.current = false;
      setBusy(false);
      xhr.current = null;
    }
  };
  const open = (id: string, download = false) => {
    const query = new URLSearchParams({
      role,
      organizationId,
      ...(download ? { download: '1' } : {}),
    });
    window.open(`/api/medical-documents/${id}?${query}`, '_blank', 'noopener,noreferrer');
  };
  return (
    <>
      {role === 'doctor' && (
        <div className="upload-zone">
          <Upload size={25} />
          <strong>Add report or handwritten prescription</strong>
          <span>PDF, JPG, JPEG or PNG · up to 10 MB · private medical documents</span>
          <label className="field">
            Document type
            <select
              aria-label="Document type"
              value={kind}
              disabled={busy || saved}
              onChange={(e) => {
                setKind(e.target.value as typeof kind);
                setRequestId(crypto.randomUUID());
              }}
            >
              <option value="report">Medical report</option>
              <option value="handwritten">Handwritten prescription</option>
            </select>
          </label>
          <input
            ref={input}
            type="file"
            disabled={busy}
            aria-label="Choose report or handwritten prescription file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
          />
          {file && (
            <p className="selected-document">
              {file.name} · {documentSize(file.size)}
            </p>
          )}
          {busy && (
            <div role="status" aria-live="polite" className="document-progress">
              {progress < 100 ? (
                <>
                  <progress max={100} value={progress} aria-label="Transfer to clinic" />
                  <span>Sending file to clinic… {progress}%</span>
                </>
              ) : (
                <>
                  <progress aria-label="Verifying private storage" />
                  <span>Saving and verifying private storage…</span>
                </>
              )}
            </div>
          )}
          <Button disabled={!file || busy} onClick={() => void upload()}>
            <Upload size={16} />
            {busy
              ? 'Uploading…'
              : saved
                ? 'Refresh uploaded report'
                : error
                  ? 'Retry Upload'
                  : 'Upload Report'}
          </Button>
          {error && (
            <p className="form-error" role="alert">
              <CircleAlert size={15} />
              {error}
            </p>
          )}
          {success && (
            <p className="document-success" role="status">
              {success}
            </p>
          )}
        </div>
      )}
      {documents.map((document) => (
        <div className="document-card" key={document.id}>
          <span className="stat-icon avatar-green">
            <FileText size={22} />
          </span>
          <div>
            <h3>{document.name}</h3>
            <p>
              {document.date} · {documentSize(document.size)}
            </p>
            <small>
              {document.kind === 'handwritten' ? 'Handwritten prescription' : 'Medical report'} ·
              Private file
            </small>
          </div>
          <div className="document-actions">
            <Button size="sm" variant="outline" onClick={() => open(document.id)}>
              <ExternalLink size={14} />
              View
            </Button>
            <Button size="sm" variant="outline" onClick={() => open(document.id, true)}>
              <Download size={14} />
              Download
            </Button>
          </div>
        </div>
      ))}
      {!documents.length && (
        <Empty title="No documents yet" text="No medical documents are attached." />
      )}
    </>
  );
}
