'use client';
import { useEffect, useRef, useState } from 'react';
import { useClinic } from './clinic-context';
import { PatientAccountAccess, type PatientAccountStatus, type PatientAccountCapabilities } from './patient-account-access';
import { PatientCredentialHandover, type CredentialSlip } from './patient-credential-handover';
import { Button } from './ui';
export type OneTimeHandover = CredentialSlip & {
  patientId: string;
  operationId: string;
  handoverNonce: string;
  handoverExpiresAt?: string | null;
  serverNow?: string | null;
  recoveryMarkerWarning?: boolean;
};
export type { PatientAccountCapabilities } from './patient-account-access';
export type PilotRegistration = {
  pilotId: string;
  state: string;
  registrationRequestId: string;
  organizationId: string;
  branchId: string;
  expectedFields: {
    name: string;
    ageYears: number;
    gender: string;
    email: string;
    phone: string;
    bloodGroup: string;
    address: string;
  };
  patientCode: string | null;
  expiresAt: string;
};
export async function patientAccessPilotStatus() {
  return (await patientAccessRequest({ action: 'pilot-status' })) as {
    pilot: PilotRegistration | null;
  };
}
export async function patientAccessCapabilities() {
  return (await patientAccessRequest({ action: 'capabilities' })) as {
    role: 'admin' | 'doctor' | null;
    capabilities: PatientAccountCapabilities;
  };
}
export async function patientAccessRequest(body: Record<string, unknown>) {
  const r = await fetch('/api/patient-access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const result = await r.json();
  if (!r.ok)
    throw new PatientAccessRequestError(
      result.error ?? 'Patient account request failed.',
      r.status,
    );
  return result;
}
class PatientAccessRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export function AccountAccessForPatient({ patientId }: { patientId: string }) {
  const { role, organizationId, actor } = useClinic();
  if (role !== 'admin') return null;
  // A changed account, scope or target unmounts the secret-bearing subtree immediately.
  return (
    <ScopedPatientAccountAccess
      key={`${actor.id}:${role}:${organizationId}:${actor.branchIds.join(',')}:${patientId}`}
      patientId={patientId}
      organizationId={organizationId}
    />
  );
}
function ScopedPatientAccountAccess({
  patientId,
  organizationId,
}: {
  patientId: string;
  organizationId: string;
}) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [status, setStatus] = useState<
      (PatientAccountStatus & {
        pilotExecutionEnabled: boolean;
        capabilities?: PatientAccountCapabilities;
      }) | null
    >(null),
    [error, setError] = useState(''),
    [slip, setSlip] = useState<OneTimeHandover | null>(null),
    [recoverySlip, setRecoverySlip] = useState<OneTimeHandover | null>(null),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    patientAccessRequest({ action: 'status', patientId, organizationId })
      .then((r) => {
        if (active) setStatus(r);
      })
      .catch((e) => {
        if (!active) return;
        setStatus(null);
        if (e instanceof PatientAccessRequestError && [401, 403, 503].includes(e.status))
          setError('');
        else setError('Account status needs review. Retry to load the latest server state.');
      });
    return () => {
      active = false;
    };
  }, [patientId, organizationId, version]);
  return (
    <>
      {error && (
        <p role="alert">
          {error}
          <Button
            variant="ghost"
            onClick={() => {
              setError('');
              setVersion((v) => v + 1);
            }}
          >
            Retry
          </Button>
        </p>
      )}
      {status && (
        <PatientAccountAccess
          status={status}
          admin
          mutationsEnabled={status.pilotExecutionEnabled === true}
          onAction={async (action, identityVerified) => {
            const r = await patientAccessRequest({
              action,
              patientId,
              organizationId,
              identityVerified,
            });
            if (!mounted.current) return;
            if (action === 'provision' || action === 'reset') setSlip(r);
            else {
              setStatus(null);
              setVersion((v) => v + 1);
            }
          }}
          onRecoveryAction={async (action, attestation) => {
            const r = await patientAccessRequest({
              action: action === 'setup' ? 'recovery-setup' : 'recovery-reset',
              patientId,
              organizationId,
              ...(action === 'setup' ? { attestation } : { operatorApproved: true }),
            });
            if (!mounted.current) return;
            if (action === 'reset') setRecoverySlip(r as OneTimeHandover);
            else {
              setStatus(null);
              setVersion((v) => v + 1);
            }
          }}
        />
      )}
      {!slip && recoverySlip && (
        <PatientCredentialHandover
          key={`recovery:${recoverySlip.operationId}:${recoverySlip.handoverExpiresAt ?? ''}`}
          slip={recoverySlip}
          expiresAt={recoverySlip.handoverExpiresAt ?? null}
          serverNow={recoverySlip.serverNow ?? null}
          recoveryMarkerWarning={recoverySlip.recoveryMarkerWarning}
          onConfirm={async () => {
            await patientAccessRequest({
              action: 'recovery-handover',
              patientId,
              organizationId,
              operationId: recoverySlip.operationId,
              nonce: recoverySlip.handoverNonce,
            });
          }}
          onDismiss={() => {
            setRecoverySlip(null);
            setStatus(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
      {slip && (
        <PatientCredentialHandover
          key={`${slip.operationId}:${slip.handoverExpiresAt ?? ''}`}
          slip={slip}
          expiresAt={slip.handoverExpiresAt ?? null}
          serverNow={slip.serverNow ?? null}
          recoveryMarkerWarning={slip.recoveryMarkerWarning}
          onConfirm={async () => {
            await patientAccessRequest({
              action: 'handover',
              patientId,
              organizationId,
              operationId: slip.operationId,
              nonce: slip.handoverNonce,
            });
          }}
          onDismiss={() => {
            setSlip(null);
            setStatus(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </>
  );
}
