import 'server-only';
import { assertPilotExecution } from './patient-access-pilot-policy';
// Pilot runs in one Next.js server process. This is not a distributed lease.
const root = globalThis as typeof globalThis & { __sroPatientPilotMutation?: boolean };
export class PilotOperationBusyError extends Error {
  constructor() {
    super('A Patient account operation is already in progress.');
  }
}
export async function runPilotAccountOperation<T>(run: () => Promise<T>): Promise<T> {
  assertPilotExecution();
  if (root.__sroPatientPilotMutation) throw new PilotOperationBusyError();
  root.__sroPatientPilotMutation = true;
  try {
    return await run();
  } finally {
    root.__sroPatientPilotMutation = false;
  }
}
