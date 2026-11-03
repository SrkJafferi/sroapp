'use client';
import { useState } from 'react';
import { PatientAccountAccess, type PatientAccountStatus } from './patient-account-access';

const attestation =
  'I confirm that Ayesha Noor (SRO0009) is an authorized fictional clinic test record under operator control. I have verified the exact existing Patient, Auth identity, clinic ownership, original pilot, and quarantined handover state. I authorize one controlled test credential recovery without claiming physical Patient identity verification.';
const capabilities = {
  role: 'admin' as const,
  provision: false,
  reset: false,
  disable: false,
  enable: false,
  handover: false,
  autoProvision: false,
};
export function SyntheticSro0009RecoveryValidation() {
  const [base] = useState(() => Date.now());
  const [status, setStatus] = useState<PatientAccountStatus>({
    patientCode: 'SRO0009',
    status: 'Pending Handover',
    loginMethod: 'Patient ID',
    emailVerified: false,
    lastSignInAt: null,
    passwordChangedAt: null,
    mustChangePassword: false,
    handoverExpiresAt: new Date(base + 10 * 60 * 1000).toISOString(),
    serverNow: new Date(base).toISOString(),
    handoverExpired: false,
    capabilities,
    recovery: {
      recoveryId: null,
      state: null,
      reissueCount: 0,
      accountState: 'pending_handover',
      pilotState: 'quarantined',
      handoverExpiresAt: new Date(base - 60 * 1000).toISOString(),
      handoverExpired: true,
      canSetup: true,
      canReset: false,
      canHandover: false,
      serverNow: new Date(base).toISOString(),
      attestation,
    },
  });
  return (
    <main style={{ padding: 40 }}>
      <h1>Synthetic SRO0009 recovery operator validation</h1>
      <p>No Auth accounts, clinical APIs, credentials or protected records are used.</p>
      <PatientAccountAccess
        status={status}
        admin
        mutationsEnabled={false}
        onAction={async (action) => {
          throw Error(`Broad action ${action} must not be available`);
        }}
        onRecoveryAction={async (action) => {
          if (action === 'setup') {
            setStatus((current) => ({
              ...current,
              recovery: current.recovery
                ? {
                    ...current.recovery,
                    state: 'prepared',
                    canSetup: false,
                    canReset: true,
                  }
                : null,
            }));
            return;
          }
          setStatus((current) => ({
            ...current,
            recovery: current.recovery
              ? {
                  ...current.recovery,
                  state: 'handover_pending',
                  canReset: false,
                  canHandover: true,
                }
              : null,
          }));
        }}
      />
    </main>
  );
}
