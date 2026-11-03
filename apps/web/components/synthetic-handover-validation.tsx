'use client';
import { useState } from 'react';
import { PatientCredentialHandover } from './patient-credential-handover';
import { credentialText } from '@/lib/credential-slip';
const fixture = {
  name: 'Synthetic Patient',
  patientCode: 'SROTEST0001',
  temporaryPassword: 'SYNTHETIC-ONLY-NotValid7!',
};
type Mode = 'fresh' | 'warning' | 'expired';
export function SyntheticHandoverValidation() {
  const [open, setOpen] = useState(true);
  const [ack, setAck] = useState(false);
  const [copyResult, setCopyResult] = useState('');
  const [mode, setMode] = useState<Mode>('fresh');
  const [base] = useState(() => Date.now());
  const window = {
    fresh: { expiresAt: new Date(base + 10 * 60 * 1000).toISOString(), serverNow: new Date(base).toISOString() },
    warning: { expiresAt: new Date(base + 90 * 1000).toISOString(), serverNow: new Date(base).toISOString() },
    expired: { expiresAt: new Date(base - 1000).toISOString(), serverNow: new Date(base).toISOString() },
  }[mode];
  const choose = (next: Mode) => {
    setMode(next);
    setAck(false);
    setOpen(true);
  };
  return (
    <main style={{ padding: 40 }}>
      <h1>Synthetic credential handover validation</h1>
      <p>No Auth accounts or clinical APIs are used. These credentials cannot authenticate.</p>
      <p role="status">
        {ack
          ? 'Synthetic handover acknowledged'
          : open
            ? 'Synthetic handover open'
            : 'Credentials discarded'}
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => choose('fresh')}>Fresh 10-minute window</button>
        <button onClick={() => choose('warning')}>Warning window</button>
        <button onClick={() => choose('expired')}>Expired window</button>
      </div>
      <p>Current synthetic window: {mode}</p>
      <button
        onClick={async () => {
          try {
            const actual = await navigator.clipboard.readText();
            setCopyResult(
              actual.replace(/\r\n/g, '\n') === credentialText(fixture)
                ? 'OS clipboard matches synthetic slip exactly'
                : 'OS clipboard did not match',
            );
          } catch {
            setCopyResult('OS clipboard read unavailable');
          }
        }}
      >
        Verify synthetic clipboard
      </button>
      <p role="status">{copyResult}</p>
      {open && (
        <PatientCredentialHandover
          key={mode}
          slip={fixture}
          expiresAt={window.expiresAt}
          serverNow={window.serverNow}
          onConfirm={async () => setAck(true)}
          onDismiss={() => setOpen(false)}
        />
      )}
    </main>
  );
}
