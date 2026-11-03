import 'server-only';
import {
  assertPilotScope,
  PilotAccessError,
  PATIENT_ACCESS_PILOT,
  type PilotOperatorScope,
} from './patient-access-pilot-policy';
import type {
  AccessDependencies,
  AccessRecord,
  PatientAccessAction,
} from './patient-access-protocol';

// Guard the capability itself, not only its HTTP caller. Tests inject non-mutating providers.
export function guardPilotDependencies(
  scope: PilotOperatorScope,
  raw: AccessDependencies,
): AccessDependencies {
  let claim: AccessRecord | null = null;
  let claimAction: 'begin' | 'reset' | null = null;
  return {
    async command(action, actor, patient, data) {
      const allowed: PatientAccessAction[] = [
        'status',
        'begin',
        'reset',
        'commit',
        'handover',
        'disable',
        'enable',
      ];
      if (!allowed.includes(action)) throw new PilotAccessError();
      assertPilotScope(scope, actor, patient, action !== 'status');
      if (action === 'commit' && (!claim || claim.operationId !== data.operationId))
        throw new PilotAccessError();
      const result = await raw.command(action, actor, patient, data);
      if (action === 'begin' || action === 'reset') {
        const r = result as AccessRecord;
        if (
          r.patientId !== PATIENT_ACCESS_PILOT.patientId ||
          r.patientCode !== PATIENT_ACCESS_PILOT.patientCode ||
          r.operationId !== data.operationId ||
          !r.userId
        )
          throw new PilotAccessError();
        claim = r;
        claimAction = action;
      }
      return result;
    },
    async createInternalUser(input) {
      assertPilotScope(scope, scope.operatorId, scope.patientId, true);
      if (
        claimAction !== 'begin' ||
        !claim ||
        input.id !== claim.userId ||
        input.email !== claim.internalEmail
      )
        throw new PilotAccessError();
      await raw.createInternalUser(input);
    },
    async replacePassword(userId, password) {
      assertPilotScope(scope, scope.operatorId, scope.patientId, true);
      if (claimAction !== 'reset' || !claim || userId !== claim.userId)
        throw new PilotAccessError();
      await raw.replacePassword(userId, password);
    },
  };
}
