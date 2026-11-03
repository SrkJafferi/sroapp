import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { clinicalContext, ClinicalError } from '@/lib/clinical-server';
import {
  authorizePilotOperator,
  assertPilotExecution,
  PATIENT_ACCESS_PILOT,
  PilotAccessError,
  pilotExecutionEnabled,
} from '@/lib/patient-access-pilot-policy';
import {
  coordinatedPatientAccessRoutesEnabled,
  coordinatedMutationAuthorized,
  patientAccountCapabilitiesFor,
  type PatientAccountRole,
} from '@/lib/patient-access-coordinated';
import { authenticatedSession } from '@/lib/auth/session';
import { appOrigin } from '@/lib/auth/mail';
import {
  patientAccessDependencies,
  patientAccessSelf,
  changeInitialPatientPassword,
  changeManagedPatientPassword,
  coordinatedPatientAccessDependencies,
  coordinatedRecoveryDependencies,
} from '@/lib/patient-access-server';
import {
  RecoveryExpiredError,
  RecoveryForbiddenError,
  RecoveryUnavailableError,
  SRO0009_RECOVERY,
  handoverWindow,
  prepareRecoveryHandover,
  recoveryHandover,
  recoverySetup,
  recoveryStatus,
  sro0009RecoveryEnabled,
} from '@/lib/sro0009-recovery';
import { prepareHandover, acknowledgeHandover, handoverHash } from '@/lib/patient-access-protocol';
import { prepareDistributedHandover } from '@/lib/patient-account-coordination';
import {
  patientWalkInPilotEnabled,
  pilotAuthorizeHandover,
  pilotAuthorizeProvision,
  pilotMarkProvisioned,
  pilotQuarantine,
  pilotStatus,
} from '@/lib/patient-walkin-pilot';
import { limit } from '@/lib/auth/rate-limit';
import {
  runPilotAccountOperation,
  PilotOperationBusyError,
} from '@/lib/patient-access-operation-lock';
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  });
async function coordinatedContext(action: string, organizationId: string) {
  if (action === 'provision' || action === 'handover') {
    try {
      return { role: 'admin' as const, context: await clinicalContext('admin', organizationId) };
    } catch (error) {
      if (error instanceof ClinicalError && error.status === 401) throw error;
      return { role: 'doctor' as const, context: await clinicalContext('doctor', organizationId) };
    }
  }
  return { role: 'admin' as const, context: await clinicalContext('admin', organizationId) };
}
export async function POST(request: NextRequest) {
  try {
    if (request.headers.get('origin') !== appOrigin())
      return reply({ error: 'Request refused.' }, 403);
    const text = await request.text();
    if (text.length > 4096) return reply({ error: 'Request too large.' }, 413);
    const input = z
      .object({
        action: z.enum([
          'provision',
          'reset',
          'status',
          'handover',
          'disable',
          'enable',
          'change-password',
          'capabilities',
          'pilot-status',
          'recovery-status',
          'recovery-setup',
          'recovery-reset',
          'recovery-handover',
        ]),
        patientId: z.uuid().optional(),
        organizationId: z.uuid().optional(),
        operationId: z.uuid().optional(),
        nonce: z
          .string()
          .regex(/^[A-Za-z0-9_-]{43}$/)
          .optional(),
        identityVerified: z.boolean().optional(),
        operatorApproved: z.boolean().optional(),
        password: z.string().max(128).optional(),
        attestation: z.string().max(500).optional(),
      })
      .strict()
      .parse(JSON.parse(text));
    if (input.action.startsWith('recovery-')) {
      if (!sro0009RecoveryEnabled())
        return reply({ error: 'The one-time Patient recovery is not authorized.' }, 403);
      const session = await authenticatedSession();
      if (!session || session.needsMfa || session.needsPasswordChange)
        return reply({ error: 'Staff session required.' }, 403);
      const context = await clinicalContext('admin', SRO0009_RECOVERY.organizationId);
      if (context.user.id !== SRO0009_RECOVERY.adminUserId)
        return reply({ error: 'The one-time Patient recovery is not authorized.' }, 403);
      if (
        (input.patientId && input.patientId !== SRO0009_RECOVERY.patientId) ||
        (input.organizationId && input.organizationId !== SRO0009_RECOVERY.organizationId)
      )
        return reply({ error: 'The one-time Patient recovery target does not match.' }, 403);
      const target = await context.client
        .from('patients')
        .select('id,organization_id,home_branch_id,patient_code')
        .eq('id', SRO0009_RECOVERY.patientId)
        .eq('organization_id', SRO0009_RECOVERY.organizationId)
        .maybeSingle();
      if (
        target.error ||
        !target.data ||
        target.data.home_branch_id !== SRO0009_RECOVERY.branchId ||
        target.data.patient_code !== SRO0009_RECOVERY.patientCode
      )
        return reply({ error: 'The one-time Patient recovery target does not match.' }, 403);
      limit('patient-sro0009-recovery', context.user.id, 5, 900000);
      if (input.action === 'recovery-status')
        return reply({ recovery: await recoveryStatus(context.user.id) });
      if (input.action === 'recovery-setup') {
        if (input.attestation !== SRO0009_RECOVERY.attestation)
          return reply({ error: 'Ownership attestation is required.' }, 400);
        return reply(await recoverySetup(context.user.id, input.attestation));
      }
      if (input.action === 'recovery-reset') {
        if (input.operatorApproved !== true)
          return reply({ error: 'Operator approval is required.' }, 400);
        return reply(
          await prepareRecoveryHandover(coordinatedRecoveryDependencies(), {
            actorId: context.user.id,
            operatorApproved: true,
          }),
        );
      }
      return reply({
        saved: true,
        ...(await recoveryHandover(
          context.user.id,
          z.uuid().parse(input.operationId),
          z.string().parse(input.nonce),
        )),
      });
    }
    if (!coordinatedMutationAuthorized(input.action))
      return reply({ error: 'Patient account mutations are not authorized.' }, 403);
    if (input.action === 'pilot-status') {
      if (!patientWalkInPilotEnabled()) return reply({ pilot: null });
      const session = await authenticatedSession();
      if (!session || session.needsMfa || session.needsPasswordChange)
        return reply({ error: 'Staff session required.' }, 403);
      return reply({ pilot: await pilotStatus(session.user.id) });
    }
    if (input.action === 'capabilities') {
      const session = await authenticatedSession();
      if (!session || session.needsMfa || session.needsPasswordChange)
        return reply({ error: 'Staff session required.' }, 403);
      let role: PatientAccountRole | null = null;
      try {
        await clinicalContext('admin');
        role = 'admin';
      } catch (error) {
        if (error instanceof ClinicalError && error.status === 401) throw error;
        try {
          await clinicalContext('doctor');
          role = 'doctor';
        } catch (doctorError) {
          if (doctorError instanceof ClinicalError && doctorError.status === 401)
            throw doctorError;
        }
      }
      let capabilities = patientAccountCapabilitiesFor(role);
      if (patientWalkInPilotEnabled()) {
        if (role === 'doctor') {
          const pilot = await pilotStatus(session.user.id);
          const ready = pilot?.state === 'registered';
          capabilities = {
            ...capabilities,
            provision: capabilities.provision && ready,
            handover: capabilities.handover && ready,
            reset: false,
            disable: false,
            enable: false,
            autoProvision: capabilities.autoProvision && ready,
          };
        } else {
          capabilities = {
            ...capabilities,
            provision: false,
            handover: false,
            reset: false,
            disable: false,
            enable: false,
            autoProvision: false,
          };
        }
      }
      return reply({ role, capabilities });
    }
    if (input.action === 'change-password') {
      const session = await authenticatedSession();
      if (!session || session.needsMfa) return reply({ error: 'Verified session required.' }, 403);
      const password = z.string().parse(input.password);
      limit('patient-password-change', session.user.id, 5, 900000);
      if (coordinatedPatientAccessRoutesEnabled()) {
        await changeManagedPatientPassword(session.client, session.user.id, password);
        return reply({ next: '/patient' });
      }
      const binding = await patientAccessSelf(session.user.id);
      if (
        binding?.patientId !== PATIENT_ACCESS_PILOT.patientId ||
        (input.patientId && input.patientId !== PATIENT_ACCESS_PILOT.patientId) ||
        (input.organizationId && input.organizationId !== PATIENT_ACCESS_PILOT.organizationId)
      )
        throw new PilotAccessError();
      assertPilotExecution();
      await runPilotAccountOperation(() =>
        changeInitialPatientPassword(
          session.client,
          session.user.id,
          password,
        ),
      );
      return reply({ next: '/patient' });
    }
    const organizationId = z.uuid().parse(input.organizationId),
      patientId = z.uuid().parse(input.patientId);
    const session = await authenticatedSession();
    if (!session || session.needsMfa || session.needsPasswordChange)
      return reply({ error: 'Staff session required.' }, 403);
    if (coordinatedPatientAccessRoutesEnabled()) {
      const { role, context } = await coordinatedContext(input.action, organizationId);
      const capabilities = patientAccountCapabilitiesFor(role);
      const allowed =
        input.action === 'provision'
          ? capabilities.provision
          : input.action === 'reset'
            ? capabilities.reset
            : input.action === 'handover'
              ? capabilities.handover
              : input.action === 'disable' || input.action === 'enable'
                ? capabilities.disable
                : true;
      if (!allowed)
        return reply({ error: 'Patient account operation is not authorized.' }, 403);
      const pilotMode = patientWalkInPilotEnabled();
      if (pilotMode) {
        if (input.action !== 'status') {
          if (role !== 'doctor' || (input.action !== 'provision' && input.action !== 'handover'))
            return reply({ error: 'Patient account operation is not authorized.' }, 403);
        }
      }
      const target = await context.client
        .from('patients')
        .select('id,organization_id,home_branch_id,patient_code')
        .eq('id', patientId)
        .eq('organization_id', context.membership.organizationId)
        .maybeSingle();
      if (target.error || !target.data)
        throw new ClinicalError('Patient account target not found.', 404);
      if (!context.membership.branchIds.includes(target.data.home_branch_id))
        throw new ClinicalError('Clinic membership is unavailable.', 403);
      limit('patient-account-management', context.user.id, 10, 900000);
      const coordinatedDeps = coordinatedPatientAccessDependencies();
      if (input.action === 'provision' || input.action === 'reset') {
        let pilotId: string | null = null;
        if (pilotMode && input.action === 'provision') {
          try {
            pilotId = (await pilotAuthorizeProvision(context.user.id, patientId)).pilotId;
          } catch {
            return reply({ error: 'Patient account operation is not authorized.' }, 403);
          }
        }
        let slip: unknown;
        try {
          slip = await prepareDistributedHandover(coordinatedDeps, {
            actorId: context.user.id,
            patientId,
            requestId: randomUUID(),
            reset: input.action === 'reset',
            identityVerified: input.identityVerified,
          });
          if (pilotId) await pilotMarkProvisioned(pilotId, patientId);
        } catch (error) {
          if (pilotId)
            await pilotQuarantine(pilotId, 'Provisioning failed or ambiguous').catch(
              () => undefined,
            );
          throw error;
        }
        return reply(slip);
      }
      if (input.action === 'handover') {
        let pilotId: string | null = null;
        if (pilotMode) {
          try {
            pilotId = (await pilotAuthorizeHandover(context.user.id, patientId)).pilotId;
          } catch {
            return reply({ error: 'Patient account operation is not authorized.' }, 403);
          }
        }
        try {
          await coordinatedDeps.command('handover', context.user.id, patientId, {
            operationId: z.uuid().parse(input.operationId),
            handoverHash: handoverHash(z.string().parse(input.nonce)),
          });
        } catch (error) {
          if (pilotId)
            await pilotQuarantine(pilotId, 'Handover failed after pilot authorization').catch(
              () => undefined,
            );
          throw error;
        }
        return reply({ saved: true });
      }
      if (input.action === 'status') {
        const result = (await coordinatedDeps.command(
          'status',
          context.user.id,
          patientId,
          {},
        )) as Record<string, unknown>;
        const statusCapabilities = pilotMode
          ? {
              ...capabilities,
              provision: false,
              handover: false,
              reset: false,
              disable: false,
              enable: false,
              autoProvision: false,
            }
          : capabilities;
        const window =
          result.status === 'Pending Handover'
            ? await handoverWindow(context.user.id, patientId).catch(() => null)
            : null;
        let recovery: Record<string, unknown> | null = null;
        if (
          sro0009RecoveryEnabled() &&
          context.user.id === SRO0009_RECOVERY.adminUserId &&
          patientId === SRO0009_RECOVERY.patientId
        ) {
          try {
            recovery = {
              ...(await recoveryStatus(context.user.id)),
              attestation: SRO0009_RECOVERY.attestation,
            };
          } catch {
            recovery = null;
          }
        }
        return reply({
          patientCode: result.patientCode,
          status: result.status,
          loginMethod: result.loginMethod,
          emailVerified: result.emailVerified === true,
          lastSignInAt: result.lastSignInAt,
          passwordChangedAt: result.passwordChangedAt,
          mustChangePassword: result.mustChangePassword === true,
          handoverExpiresAt: window?.handoverExpiresAt ?? null,
          serverNow: window?.serverNow ?? null,
          handoverExpired: window?.handoverExpired ?? false,
          recovery,
          pilotExecutionEnabled:
            statusCapabilities.provision ||
            statusCapabilities.reset ||
            statusCapabilities.disable,
          capabilities: statusCapabilities,
        });
      }
      await coordinatedDeps.command(
        input.action as 'disable' | 'enable',
        context.user.id,
        patientId,
        {},
      );
      return reply({ saved: true });
    }
    const context = await clinicalContext('admin', organizationId);
    const scope = authorizePilotOperator(
      {
        id: context.user.id,
        verified: !!context.user.email_confirmed_at,
        mfaSatisfied: !context.needsMfa,
        memberships: context.identity.memberships,
      },
      organizationId,
      patientId,
    );
    const target = await context.client
      .from('patients')
      .select('id,organization_id,home_branch_id,patient_code')
      .eq('id', scope.patientId)
      .eq('organization_id', scope.organizationId)
      .maybeSingle();
    if (
      target.error ||
      !target.data ||
      target.data.home_branch_id !== scope.branchId ||
      target.data.patient_code !== PATIENT_ACCESS_PILOT.patientCode
    )
      throw new PilotAccessError();
    if (input.action !== 'status') assertPilotExecution();
    limit('patient-account-management', context.user.id, 10, 900000);
    const deps = patientAccessDependencies(scope);
    if (input.action === 'provision' || input.action === 'reset')
      return await runPilotAccountOperation(async () =>
        reply(
          await prepareHandover(deps, {
            approved: pilotExecutionEnabled(),
            actor: context.user.id,
            patientId,
            reset: input.action === 'reset',
            identityVerified: input.identityVerified,
          }),
        ),
      );
    if (input.action === 'handover') {
      await runPilotAccountOperation(() =>
        acknowledgeHandover(deps, {
          approved: pilotExecutionEnabled(),
          actor: context.user.id,
          patientId,
          operationId: z.uuid().parse(input.operationId),
          nonce: z.string().parse(input.nonce),
        }),
      );
      return reply({ saved: true });
    }
    const result =
      input.action === 'status'
        ? await deps.command('status', context.user.id, patientId, {})
        : await runPilotAccountOperation(() =>
            deps.command(input.action as 'disable' | 'enable', context.user.id, patientId, {}),
          );
    if (input.action === 'status') {
      const s = result as Record<string, unknown>;
      if (s.patientCode !== PATIENT_ACCESS_PILOT.patientCode) throw new PilotAccessError();
      const capabilities = patientAccountCapabilitiesFor('admin');
      return reply({
        patientCode: s.patientCode,
        status: s.status,
        loginMethod: s.loginMethod,
        emailVerified: s.emailVerified === true,
        lastSignInAt: s.lastSignInAt,
        passwordChangedAt: s.passwordChangedAt,
        mustChangePassword: s.mustChangePassword === true,
        pilotExecutionEnabled:
          capabilities.provision || capabilities.reset || capabilities.disable,
        capabilities,
      });
    }
    return reply({ saved: true });
  } catch (error) {
    if (error instanceof RecoveryExpiredError) return reply({ error: error.message }, 409);
    if (error instanceof RecoveryForbiddenError) return reply({ error: error.message }, 403);
    if (error instanceof RecoveryUnavailableError) return reply({ error: error.message }, 503);
    if (error instanceof PilotOperationBusyError) return reply({ error: error.message }, 409);
    if (error instanceof PilotAccessError) return reply({ error: error.message }, error.status);
    if (error instanceof ClinicalError)
      return reply({ error: 'Patient account operation refused.' }, error.status);
    return reply(
      {
        error:
          'Patient account operation refused. Confirm identity and clinic authorization, or contact the administrator.',
      },
      400,
    );
  }
}
