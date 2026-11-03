import 'server-only';
// Identity/branch values were independently read from the protected database.
// Neither environment variables, request bodies nor the global UI flag can enable writes.
export const PATIENT_ACCESS_PILOT = Object.freeze({
  projectRef: 'jyigxpjvygvtvcypujel',
  organizationId: '88645fbe-34da-48aa-a509-c24441b7cf72',
  branchId: '5680d806-8a14-48d3-a0ac-d1cd12eddff3',
  patientId: 'b9cb9ff4-0c77-4caa-b412-e5794b419f75',
  patientCode: 'SRO0007',
  operatorId: 'c9095e1e-b718-4c09-842f-df48970125af',
  fictionalOperatorControlledConfirmed: true,
  executionApproved: true,
} as const);

export class PilotAccessError extends Error {
  constructor(readonly status: 403 | 503 = 403) {
    super(
      status === 503
        ? 'Patient pilot execution awaits separate authorization.'
        : 'Patient account operation refused.',
    );
  }
}
export type PilotPrincipal = {
  id: string;
  verified: boolean;
  mfaSatisfied: boolean;
  memberships: { organizationId: string; roles: readonly string[]; branchIds: readonly string[] }[];
};
export type PilotOperatorScope = Readonly<{
  kind: 'operator';
  operatorId: string;
  organizationId: string;
  patientId: string;
  branchId: string;
}>;
const issuedScopes = new WeakSet<object>();
export function pilotExecutionEnabled() {
  return PATIENT_ACCESS_PILOT.executionApproved;
}
export function assertPilotExecution() {
  if (!pilotExecutionEnabled()) throw new PilotAccessError(503);
}
export function authorizePilotOperator(
  principal: PilotPrincipal,
  organizationId: string,
  patientId: string,
): PilotOperatorScope {
  const p = PATIENT_ACCESS_PILOT;
  if (
    !principal.verified ||
    !principal.mfaSatisfied ||
    principal.id !== p.operatorId ||
    organizationId !== p.organizationId ||
    patientId !== p.patientId ||
    !principal.memberships.some(
      (m) =>
        m.organizationId === p.organizationId &&
        m.roles.includes('admin') &&
        m.branchIds.includes(p.branchId),
    )
  )
    throw new PilotAccessError();
  const scope = Object.freeze({
    kind: 'operator',
    operatorId: p.operatorId,
    organizationId: p.organizationId,
    patientId: p.patientId,
    branchId: p.branchId,
  });
  issuedScopes.add(scope);
  return scope;
}
export function assertPilotScope(
  scope: PilotOperatorScope,
  actor: string | null,
  patient: string | null,
  write = false,
) {
  const p = PATIENT_ACCESS_PILOT;
  if (
    !issuedScopes.has(scope) ||
    scope.kind !== 'operator' ||
    scope.operatorId !== p.operatorId ||
    scope.organizationId !== p.organizationId ||
    scope.branchId !== p.branchId ||
    scope.patientId !== p.patientId ||
    actor !== p.operatorId ||
    patient !== p.patientId
  )
    throw new PilotAccessError();
  if (write) assertPilotExecution();
}
export function assertPilotPatientBinding(patientId: string) {
  if (patientId !== PATIENT_ACCESS_PILOT.patientId) throw new PilotAccessError();
  assertPilotExecution();
}
export const isReservedPatientIdentity = (email: unknown) =>
  typeof email === 'string' && email.toLowerCase().endsWith('.invalid');
export const isPatientIdAttempt = (identifier: unknown) =>
  typeof identifier === 'string' && /^sro/i.test(identifier.trim());
