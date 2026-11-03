// Serializable authorization contract shared by Web and future Expo Auth adapters.
export type WorkspaceRole = 'admin' | 'doctor' | 'patient';
export type WorkspaceMembership = {
  organizationId: string;
  branchIds: string[];
  roles: WorkspaceRole[];
};
export type AuthIdentity = {
  id: string;
  email: string;
  name: string;
  memberships: WorkspaceMembership[];
};
