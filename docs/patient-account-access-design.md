# Patient ID login and staff-managed account access

Current execution update: the separately approved SRO0007-only live pilot has completed its core Auth/API lifecycle. See [the live pilot report](patient-access-live-pilot.md). The migration-only/preparation status below is historical; global automatic provisioning remains OFF.

Status: **migration-only deployed; feature OFF; no Patient Auth provisioning authorized or executed**. Target: `jyigxpjvygvtvcypujel` only. Deployment verified 30 October 2026 (Asia/Karachi). See [actual deployment evidence and next approval gate](patient-account-access-deployment.md). The design and local-test evidence below retain their original review context; the migration-only deployment report supersedes the former pending-migration status. Do not rerun the preparation script against a deployed manifest.

## Approval boundary and actual baseline

Latest preparation update: [the SRO0007 pilot guard](patient-access-pilot-readiness.md) permits the named operator's scoped read-only status only. All account/password execution remains OFF. This supersedes the original blanket-503 API description below without broadening the global feature or migration approval.

The user requires explicit approval before applying SQL or creating/modifying protected Auth accounts. The new feature switch is deliberately `false` in `apps/web/lib/patient-access-feature.ts`. `/api/patient-access` returns 503 before identity lookup or Auth administration. Existing email login and clinical workflows remain active.

Read-only target inspection found PostgreSQL **17.11.0.003**, organization `grklqcvwrbikvulbjsrp`, region `ap-south-1`; 17 recorded application migrations; 8 Patients, 1 linked Auth identity, and SRO0007/SRO0008 both unlinked. A final read-only count confirmed that baseline remains unchanged. No protected account was provisioned, reset, linked, enabled or disabled. Routine existing-account sign-in smoke tests created normal sessions; no credentials or account configuration were changed.

No existing Patient, SRO code, Auth user, clinical record, appointment, avatar or branch relationship is recreated. There is no mass backfill/provisioning operation.

## Candidate and exact database changes

- File: `supabase/proposals/patient-access/20261029182220_clinic_patient_account_access.sql`
- SHA-256: `fb9382e290899f02528b01a4de334a90de06665f6763dc275a22f738eb2bb79b`
- Manifest: `supabase/proposals/patient-access/manifest.json`.
- Isolated bundle: `artifacts/patient-access-deployment`.

The single transaction:

1. Adds forced-RLS private `clinic_private.patient_accounts`, inaccessible directly to anon/authenticated/service_role. It stores the existing Patient binding, reserved Auth UUID, private alias, operation/lifecycle/session state, nonce hash/expiry and password-change attestation. It does **not** store plaintext, encrypted/recoverable passwords or a patient-facing password viewer.
2. Adds service-role-only `public.patient_account_command` and `public.patient_login_limit`. Both are SECURITY DEFINER with empty search paths and no anon/authenticated EXECUTE. Private authorization/session helpers also have explicit restricted grants.
3. Extends existing `clinic_private.phase2b_assurance()` to require an eligible session for managed Patient accounts, preserving its existing MFA condition. Existing restrictive table policies and membership/RPC checks reuse that guard; no permissive RLS policy is added. Unmanaged existing accounts retain their previous behavior.
4. Replaces `profiles_email_check` narrowly: a blank public profile email is valid only for a Patient principal mapped to a private internal identity. Ordinary existing email validation remains. This avoids publishing internal aliases in publicly projected profiles.
5. Wraps the existing authorized `get_clinic_profile` reader to redact internal login aliases. Its underlying profile authorization and write commands remain unchanged.
6. Emits a PostgREST schema reload. No seed, roles file, Auth settings change or existing migration replay is included.

`scripts/prepare-patient-access-deployment.mjs` verifies the SHA-256 of all 17 historical source migrations against their existing manifests before copying them into the isolated history bundle. It rejects unexpected files, generates the candidate manifest, and never applies SQL. The most recent historical migration is `20261028131406_clinic_incomplete_onboarding_recovery.sql`; remote history confirms it is already applied even though its older proposal manifest still says otherwise. This task does not rewrite that historical evidence.

## Identity model

The permanent SRO code remains a public identifier, **never a credential**. UUIDs and existing relationships remain authoritative internally. A new email-less principal receives a random reserved identifier under `accounts.sro.invalid`, independently of the SRO code. `.invalid` cannot represent ownership of a real mailbox. Its confirmation is confirmation of a clinic-controlled internal principal; it never marks the Patient's contact email as owned or verified. Global email confirmation remains enabled.

The Auth Admin API receives a reserved UUID and cryptographically random password. The server verifies the same UUID, confirmed active identity and expected internal alias before atomically linking it to the existing Patient and assigning **Patient only** memberships/role. An already linked Patient, existing operation, privileged/shared identity, wrong organization or disabled membership is refused.

Contact email/phone stay optional and are never used to resolve an email-less Patient login or recovery. Existing verified Auth email Patients can use their verified email/password or their SRO code/password. Linking a future verified email to an internal principal needs a separately reviewed ownership-verification workflow; merely editing contact details does not enable email login.

Internal aliases are omitted from HTTP handover/status/identity/profile responses, URLs, printed slips and clinical profiles. Supabase's own JWT/Auth identity can contain its internal email claim; an authenticated user's inspection of their own cookie/token is not prevented. These tokens are kept in the existing HttpOnly SSR cookies and are not rendered as patient contact data.

## Provisioning lifecycle and partial failures

| State                  | Meaning                                                             | Clinical data access                      |
| ---------------------- | ------------------------------------------------------------------- | ----------------------------------------- |
| No private account row | Existing account or not provisioned; unchanged legacy authorization | Existing RLS only                         |
| provisioning           | Patient row locked; unique operation and Auth UUID reserved         | Denied                                    |
| pending_handover       | Provider creation/password operation and database link committed    | Denied                                    |
| change_required        | Exact staff operator acknowledged private handover                  | Denied until password change completes    |
| active                 | Different password confirmed and session bound                      | Existing Patient RLS + session/MFA checks |
| resetting              | Admin verified identity and fenced prior sessions before Auth reset | Denied                                    |
| disabled               | Login/clinical access disabled by clinic policy                     | Denied                                    |

The existing ordinary user-session `register_walk_in_patient` RPC still validates demographics, allocates the SRO code and commits the clinical Patient transaction. The prepared form then requests server provisioning for **that returned UUID**. Registration idempotency stays with its original request UUID. An Auth provider call cannot share a PostgreSQL transaction with clinical registration; these are deliberately modeled as a fail-closed saga, rather than claiming cross-service atomicity.

Patient row `FOR UPDATE`, unique Patient/Auth/operation identifiers and operation matching prevent duplicate identities under retried requests. Admin authority is checked against the actual home/managed branch. Doctor initial provisioning and handover require their own unexpired intake, active Doctor/organization/profile/branch/assignment and verified session. Those authority rows are share-locked while the SQL command executes. Each later command revalidates authority. Doctors cannot reset or administer existing accounts.

If registration succeeds but provisioning fails, the UI states that the Patient is registered and login is pending; it warns against duplicate registration. It retains the registration request ID. A lost HTTP response never recreates a Patient or overwrites a linked account. A completed-but-unreceived handover needs an Admin identity check and new credentials.

**Ambiguous provider operations remain quarantined.** `provisioning`/`resetting` cannot be automatically reset or superseded, even after a timeout: a delayed prior Auth write could otherwise overwrite a newer password. Operator recovery requires stopping/draining the original operation, inspecting only the recorded reserved UUID through supported Auth administration, confirming no in-flight provider write, and separately reviewing a narrowly scoped recovery/repair. Never clear the claim and retry registration or create a second identity. This unusual partial-failure recovery is intentionally not an unrestricted browser action.

## One-time handover

The server generates a 32-byte random password plus complexity suffix and independent 32-byte nonce. Only the SHA-256 nonce, its ten-minute acknowledgement expiry and a 24-hour initial-password expiry are retained. A SHA-256 fingerprint of the existing provider password hash attests that a password changed; it cannot recover the password and is cleared after activation. No SQL password hashing/reimplementation of Supabase Auth is introduced.

The `private, no-store` HTTP response returns Patient name/code, temporary password and opaque operation/nonce exactly for that handover. They stay in component memory; no localStorage, shared clinical cache, URL, email, analytics or audit entry receives them. Reveal, Copy and Print are explicit staff actions. The print document uses textContent, detaches its opener and closes after printing or modal unmount. Dismissal drops the component state. There is no retrieval endpoint. JavaScript garbage collection cannot guarantee physical heap erasure; deliberate clipboard/printed copies belong to the private handover and must be handled under the clinic's procedure.

Staff confirm in-person identity and private handover before activation. The same operator, operation and unexpired nonce must match; acknowledgement is single-use. Dismissal or expired acknowledgement leaves access pending. Reissue uses a new credential, not recovery of the old one.

## Login, first password change and session protection

The gated login label is **Patient ID or Email**, with canonical SRO codes of four or more digits and email/password support. Code resolution is service-only on the server and requires an eligible verified Auth identity and Patient-only role. No unrestricted patient lookup is exposed. Invalid/unknown identifiers perform a dummy Auth password request and return the same public failure as a wrong password. Failure latency has a minimum plus random jitter. The persistent SQL limiter applies to every attempt by HMAC identifier and IP, including failures; it is shared across app instances. Generic failure responses also cover throttling.

Production deployment must ensure `x-forwarded-for` is overwritten by the trusted proxy and protected by an edge/IP rate limit; an arbitrary client-supplied header is not an authoritative source IP. The identifier bucket remains effective independently of that header. Failure-time distributions still need measurement against the real deployed Auth service; padding/jitter are mitigation, not a proof of identical network latency. Shared-clinic NAT rate-limit capacity needs operational review (current ceiling: 10 attempts per identifier and IP per 15 minutes, successes included).

A temporary-password login establishes a normal Supabase session and redirects to `/auth/change-password` (MFA first when already enrolled). Both server clinical/profile/Auth mutations and direct table/RPC access remain blocked until activation. The server validates strength, checks that the proposed replacement differs, calls supported user `auth.updateUser`, and activates only after the provider hash has changed and an eligible real `auth.sessions` ID matches the verified caller. Concurrent old temporary sessions cannot become active. A failed database completion stays blocked; an Admin may need to reissue after identity review.

Managed active access checks session existence, expiry, Auth banned/deleted/confirmation state and a per-account session epoch. Reset/disable moves that epoch and clears the previous allowed session, so old JWTs cannot regain clinical access even while cryptographically valid. Enable requires a fresh login and cannot bypass an incomplete handover/password-change state. Existing MFA factors are never removed.

Resets use supported Admin password update, with the DB gate closed **before** the provider call. Current upstream Supabase Auth updates revoke other/all sessions as appropriate; the actual protected runtime must still be tested after approval. The application does not mutate `auth.sessions`, assume token signatures are instantly revoked, or rely exclusively on provider logout. Disable/enable enforces application/session/RLS access; it does not alter provider ban configuration. A direct GoTrue request can still issue an otherwise valid token for a clinic-disabled identity, but that token cannot open the workspace or protected clinical data.

Admin Account Access shows code, four requested public statuses, login method, verified-email status, provider last sign-in and the last **clinic-confirmed** password-change date. It cannot display the existing password. Out-of-band Auth changes cannot be reliably dated from `auth.users.updated_at`, so that unrelated timestamp is not substituted.

## Local and live evidence

| Check                                                                         | Actual result                                                                                                                          |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Existing 17 source hashes                                                     | Verified unchanged against manifests                                                                                                   |
| Isolated linked CLI dry-run                                                   | Exactly `20261029182220_clinic_patient_account_access.sql`; no seeds/roles; `--skip-vault`; no apply                                   |
| SQL runtime                                                                   | PGlite PostgreSQL **17.5 WASM**, not remote PostgreSQL 17.11                                                                           |
| Replay                                                                        | All 17 existing application migrations plus candidate replayed locally; genuine prior numbering baseline supplied by fictional fixture |
| New security/protocol tests                                                   | **25/25** including parent (19 SQL scenarios + parent, 5 protocol cases)                                                               |
| Existing Auth/policy/cache/onboarding contract regressions                    | **16/16** with Node `--conditions=react-server`                                                                                        |
| Web TypeScript / focused new database-test TypeScript                         | Pass                                                                                                                                   |
| Web lint                                                                      | Pass                                                                                                                                   |
| Isolated Next.js production build                                             | Pass; existing configured origin/environment; no Android build                                                                         |
| Existing Admin/Doctor/Patient email login + scoped `/api/clinic` on port 3100 | HTTP 200 for all three                                                                                                                 |
| Anonymous `/api/clinic`                                                       | HTTP 401                                                                                                                               |
| New provisioning API while gate is off                                        | HTTP 503 for all three roles; no provider writes                                                                                       |
| Existing login in actual in-app browser                                       | Rendered normally with existing Email address/password form and branding; gated feature remains hidden                                 |
| Protected final baseline                                                      | 8 Patients, 1 linked Auth identity; SRO0007/SRO0008 still unlinked                                                                     |

Local tests use actual application SQL/grants/RLS with `SET ROLE`, but Auth/Storage system tables are fixture shapes. They do not execute GoTrue/PostgREST or true independent-connection races. Native multi-connection provisioning/reset/first-change races, real new internal Auth identity creation, one-time print/copy handover, first password change, Patient ID browser login, fresh-session persistence and provider session revocation remain **pending approval**. No simulated upload/login is claimed as live proof.

The broad existing `pnpm typecheck:db` remains blocked by six unrelated `unknown` typing errors in `tests/database/staff-booking.test.ts` (lines 181, 293 twice, 389, 390) and `tests/database/walk-in.test.ts` (line 410). No unrelated test files were changed. The new SQL/protocol tests passed a separate focused TypeScript project. Initial server-only regression execution required the correct `react-server` Node condition; the corrected run passed.

Reproducible checks:

```powershell
node scripts/prepare-patient-access-deployment.mjs
npx --yes supabase@2.122.0 link --project-ref jyigxpjvygvtvcypujel --workdir artifacts/patient-access-deployment
npx --yes supabase@2.122.0 db push --linked --dry-run --skip-vault --workdir artifacts/patient-access-deployment
pnpm exec tsx --test tests/database/patient-access.test.ts tests/patient-access-protocol.test.ts
node --conditions=react-server --import tsx --test tests/auth-server.test.ts tests/auth-policy.test.ts tests/clinical-cache.test.ts tests/onboarding-profile-contract.test.ts
pnpm --filter @sro/web typecheck
pnpm --filter @sro/web lint
$env:SRO_ISOLATED_BUILD='1'
pnpm --filter @sro/web build
Remove-Item Env:SRO_ISOLATED_BUILD
node scripts/verify-patient-access-gate.mjs
```

The last script uses existing privately configured accounts, performs normal sign-ins/clinical reads and asserts the **disabled** API gate; it never provisions or resets an account. Sanitized results are in `artifacts/patient-access-validation/active-regression.json`.

## Controlled deployment after explicit approval only

1. Reverify exact target, migration history, candidate/hash and patient/Auth linkage baseline. Stop for drift. Review the constraint and existing assurance-wrapper changes, not just the new table.
2. Keep the application switch OFF. Rebuild the isolated bundle and repeat its one-candidate dry-run. No seeds, staging files, roles, Vault updates or old migration application.
3. Only after approval, apply that one candidate using the same isolated bundle and `db push --linked --skip-vault`. Run `scripts/patient-access-post-deployment-checks.sql` read-only and inspect advisor/grant/function results. If any check fails, keep the switch OFF.
4. Separately approve gated application activation and **named** fictional Patient provisioning. Verify SRO0007/SRO0008 individually under Admin review, retaining their UUIDs/codes and all clinical relationships. Never reset the existing linked identity merely to test the feature. No background loop provisions all seven unlinked Patients.
5. Complete all 14 user-requested browser acceptance scenarios using an approved controlled fictional Patient and existing verified-email identity; include direct authenticated/anonymous RPC denial, cross-branch/organization denial, rejected role escalation, old JWT/session denial, native races, refresh/fresh session and the first-password-change gate. No real patient or uncontrolled email delivery is needed. Return to the approval gate on any security failure.
6. Enable wider staff use only after those live results pass. Verify trusted proxy/IP handling and shared-NAT rate limits before public exposure.

## Rollback and recovery

Before migration, abort normally; the active app is unchanged. The SQL itself is transactional. Before any account is provisioned, leaving the additive migration unused with the flag OFF is the safest application rollback; do not improvise an object reset.

After any managed identity is created, **do not revert the RLS session guard or deploy an older app that bypasses it**. Turning the feature OFF stops new provisioning but must not be treated as full recovery for already managed users. Keep managed accounts fenced, preserve the session gate/private bindings, stop staff writes and use reviewed fix-forward recovery. No password is recoverable from this system; lost handovers need in-person reissue. A partial provider operation needs the drained-operation review described above. Never delete the Patient, recycle its code, clear clinical history or delete an Auth user to force a retry.

Logical recovery must preserve the private mapping before validating blank internal-profile emails (the constraint depends on that mapping). Do not assume a paid backup/PITR restore capability. Preserve a pre-change export/recovery plan appropriate to the current project, with secret-safe handling and separate approval if restoration is required.

## Files prepared/modified

New SQL/manifest; `scripts/prepare-patient-access-deployment.mjs`, `scripts/patient-access-post-deployment-checks.sql`, `scripts/verify-patient-access-gate.mjs`; `tests/database/patient-access.test.ts`, `tests/patient-access-protocol.test.ts`; `apps/web/lib/patient-access-{feature,protocol,server}.ts`; `apps/web/app/api/patient-access/route.ts`; `apps/web/components/patient-{access-client,account-access,credential-handover,initial-password}.tsx`; this document.

Gated integration edits: `apps/web/lib/auth/session.ts`, `apps/web/lib/clinical-server.ts`, `apps/web/lib/profile-server.ts`, `apps/web/app/api/auth/[action]/route.ts`, `apps/web/app/auth/[mode]/page.tsx`, `apps/web/components/auth-screen.tsx`, `apps/web/components/admin-forms.tsx`, `apps/web/components/screens.tsx`.

No package/dependency changes, environment credential edits, previous migration modifications, medical-record writes or Android builds.

**Recommendation:** ready for review of the one candidate and a supervised rollout plan; **NO-GO for unapproved protected deployment, bulk provisioning or claiming completed live Patient ID acceptance.**

Implementation references: [Supabase Admin creation](https://supabase.com/docs/reference/javascript/auth-admin-createuser), [Admin password update](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid), [session security](https://supabase.com/docs/guides/auth/sessions), [upstream password update/session invalidation](https://github.com/supabase/auth/blob/master/internal/models/user.go). Upstream behavior is not a substitute for the pending actual-runtime tests.
