# Phase 2A migration safety and Phase 2B handoff

## Approval boundary

Latest runtime evidence and current hashes: [Phase 2A.5 final validation](phase2a5-final-validation.md). Native/JWT gates described below have now been exercised in approved staging. Staging credential exposure and explicit protected-target/hash approval remain operational gates. Only the three manifest candidates may be deployed; staging access/reset/repair history is excluded.

**Remote application is not approved and has not occurred.** The candidate project is **`jyigxpjvygvtvcypujel`** — **sro@pakiwebhost.com's Project**, `ap-south-1`, PostgreSQL `17.11.0.003`. The Web/Expo public URL refs and read-only connector metadata matched. Public tables and migration history were empty when inspected. `supabase/target-project.json` records the observation; it neither links the CLI nor grants authorization.

The candidate migration files, created with Supabase CLI **2.122.0** `migration new`, are:

1. `20261026024332_clinic_foundation.sql` — schema, constraints, reservation exclusions, indexes, RLS enable/force and initial deny-by-default grants.
2. `20261026024335_clinic_access_policies.sql` — authoritative membership helpers, branch/clinical SELECT policies and narrow read-marker update policy.
3. `20261026024338_clinic_transaction_commands.sql` — scoped write commands, safe availability, immutable clinical/audit guards and explicit function grants.

CLI migration timestamps are UTC; the review date is 25 October 2026 in America/Los_Angeles. The checked-in file hashes in `supabase/migration-manifest.json` identify the candidate contents. Re-review if any migration changes after approval.

The final [security readiness review](phase2a-security-review.md) records confirmed fixes and replacement hashes. The earlier 48-test candidate is superseded; its hashes must not be used for approval. The local candidate passes expanded checks, but is **not cleared for target deployment** until the native PostgreSQL/PostgREST gates pass and explicit target/hash approval is obtained.

## Changes requiring explicit approval

- Confirm **the exact project ref above**, its organization/display name and the three reviewed migration contents. Re-read the target identity, existing schemas/extensions/migration history and data immediately before any apply; an empty-project observation is not permanent authorization.
- Approve creation of 34 public tables, private schema/table/functions, enum types, `btree_gist` in `extensions`, indexes and constraints. An already-installed extension must be inspected for compatible version/schema before applying.
- Approve explicit authenticated Data API SELECT/RPC grants, zero anonymous access, and `clinic_private` remaining outside exposed API schemas. No clinical table can rely on default grants.
- Approve explicit branch memberships for Admin/Doctor/Patient access, including patients losing branch-scoped record visibility on revocation. Approved care assignments retain authorized history access until deactivated; a pending request alone grants no clinical access.
- Approve the reservation rule retaining holds for unresolved `doctor_unavailable` visits, patient-overlap prevention, one-year maximum clinical grants, and assigned-Doctor-only signing. These are stricter than parts of the mock permissions.
- Approve Doctor follow-up booking requiring existing active primary care, denial of operational writes after assignment revocation, and conservative calendar/timezone guards around future holds. A temporary clinical grant cannot establish durable primary care.
- Approve revoking CREATE on `public` from ordinary/anonymous roles and the scoped service-role provisioning/read grants. No global default privileges, Auth provider configuration or unrelated existing table grants are modified.
- Approve a separately reviewed bootstrap of the real organization, branches, first Admin and memberships after real Auth identity is available. The fictional fixture is **not** that bootstrap.
- Before real users/data or an app adapter switch: approve and execute native PostgreSQL 17.11 multi-connection race tests, full Supabase/PostgREST JWT/RLS integration tests and platform security advisors. Local WASM results do not replace these gates.

No remote seed, Auth setup, invitation email, payment integration, subscription, Storage bucket/policy, app adapter switch or APK build is included in this approval request. Each belongs to its own authorized module.

## Local reproducibility

```powershell
pnpm install --frozen-lockfile
pnpm check:db
pnpm typecheck:db
```

`check:db` starts an **ephemeral in-process PostgreSQL 17.5 WASM** instance via pinned development-only PGlite **0.4.6**. The harness creates local Auth-compatible UUID/role shims, replays all three SQL files and loads `supabase/fixtures/fictional.sql`. It executes real database permissions, RLS, functions and constraints as `anon`/`authenticated`, with rollback between tests, then checks generated contracts for catalog drift. It never reads environment files, accepts a database URL, starts a system service or connects to Supabase.

The original 48 security scenarios remain, with 22 readiness regressions/checks in `tests/database/readiness.test.ts` (70 total). These include additional per-table/role assertions: anonymous access, user-metadata forgery, missing identity, organization/branch separation, self-escalation, direct DML/TRUNCATE, invitations, pending clinical access, assignment/grant access, expiry/revocation, draft/signed notes/Rx, immutable records, notification ownership, paid/free charges, slot alignment/break/leave rules, overlap, reschedule/cancellation holds, malformed payloads, composite FK tampering, capability ACLs and rollback. New checks cover access laundering, revoked primary care, post-lock authority fault injection, permissive default ACL cleanup, calendar/timezone integrity, owner/search-path prerequisites, late prescription rollback and exact manifest hashes. No real login or Auth account is created by the migrations.

To regenerate **local candidate** TypeScript contracts after a reviewed schema change:

```powershell
pnpm db:types
```

Types are derived from the replayed catalog, including nullable/default/generated fields, composite relationships, enums and eight RPC signatures. This is not a remote-schema type generation command.

The optional `tests/database/booking-race.spec` is a PostgreSQL isolationtester specification for a newly created disposable fixture database. It describes two real backends contending for one slot; the second must block and then fail `23P01` after the first commits. The file is prepared but was **not executed**: native PostgreSQL/isolationtester and Docker are not installed here. Do not point it at the Supabase project or a database with real data.

See [the outstanding native/JWT test matrix](../tests/database/README.md) for cross-branch, patient overlap, calendar/leave, reschedule, revocation and disconnect orderings. The local lock-boundary tests are fault injection in one connection, not concurrency proof.

## Migration and rollback procedure after approval

1. Record the approved project ref and exact manifest hashes. Check the target again and abort on any mismatch or unexpected existing schema/data. Do not automatically resolve collisions with `DROP`, `--include-all`, migration repair or broad grants.
2. Capture a target backup/schema/privilege inventory and verify recovery access. Confirm PostgreSQL 17, `btree_gist` availability and private schema exclusion from Data API exposure.
3. First replay the exact candidate against a disposable environment matching Supabase/PostgreSQL **17.11**. Complete the multi-backend and PostgREST tests plus platform advisors; review differences from the local 17.5 harness.
4. Apply only these files to the approved project with an explicit, reviewed remote workflow. No automatic `db push`, linking, seed or deploy script is supplied here. Each SQL file has a transaction boundary; its failure rolls back that file. Earlier successfully applied files may remain, with their deny-by-default access, if a later file fails.
5. Compare migration history and generated remote types to the approved local catalog. Verify RLS/ACLs as real ordinary user JWTs, not only as a database owner/service key. Do not switch apps from mocks until that gate passes.

Before application data exists, recover a failed disposable deployment by recreating that disposable environment. For the approved remote project, prefer restore from the verified pre-apply backup or an explicitly reviewed inverse migration targeting only these exact objects, in reverse dependency order. Do not drop `auth`, `public`, shared extensions or unrelated objects, and do not treat `CASCADE` as a general cleanup tool.

After any patient/clinical data exists, favor a forward corrective migration and preserve clinical/audit history. A destructive down migration would lose records and requires a separate retention/recovery decision. Reversing privileges also needs review; do not reopen public access to make a rollback appear successful. The append-only/signed guards intentionally require an exceptional, documented database-owner recovery process rather than ordinary app edits.

## Concise Phase 2B handoff

Start only after separate instructions. Implement one Web-first module at a time:

1. Confirm project/plan approval, pass the remaining deployment gates and bootstrap real administrative authority through a reviewed trusted path.
2. Supabase email/password sessions and protected role/branch context. Resolve roles from the membership tables; keep the mock persona selector separate. Derive optional MFA state from verified factors.
3. A typed asynchronous repository using ordinary user JWT/RLS and the eight approved RPCs, with DTO conversions described in [database architecture](database-architecture.md). Never use a service key as a general client repository.
4. Doctor invitations via server-only Resend: expiring, single-use token hashes, no raw token persistence, scoped Admin authorization and auditable acceptance/provisioning. No email delivery code exists yet.
5. Review missing administrative/clinical-edit capabilities before adding RPCs: role/branch provisioning audit, schedule edits under the shared doctor lock, baseline medical-history changes, manual payments and private document storage. `can_write` grants do not bypass this review.
6. Validate auth/JWT claims, real Data API behavior and secure Web/Expo shared access. Defer realtime, gateways and release APK validation to separately requested modules/milestones.

The current Web/Android mock adapters and business features remain unchanged. Phase 2A stops with these local review deliverables.
