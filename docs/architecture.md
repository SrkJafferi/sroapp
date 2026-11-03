# Phase 1 architecture

Current status: Phase 2A, Phase 2B and the approved Phase 2C workspace commands are deployed. Next.js uses real verified Auth, database memberships, RLS-protected reads and user-session clinical RPCs. Expo retains its Phase 1 mock adapter. See [Phase 2C actual validation](phase2c-validation.md); the Phase 1 description below is historical context.

## Current Web clinical adapter

`/api/clinic` resolves the verified actor, organization and active branch memberships from trusted database rows. It uses the ordinary user's JWT for all clinical access. `clinical-projector.ts` maps authorized rows to shared entities; `ClinicProvider` refreshes after writes and polls visible pages every 15 seconds. There is no seeded Web fallback. Availability uses published PostgreSQL slots; booking, transitions, drafts/signing, history and calendar changes use guarded transactional commands. The database enforces branch/care access, slot collision prevention and signed-record immutability.

Service credentials remain in server-only identity onboarding modules; the clinical adapter does not use them. Passwords for the three operator-controlled fictional accounts are in the operator/SYSTEM-only vault outside the repository. Private lifecycle markers are preserved, while portal and email copy contains no demo/preview labels. Expo's existing shared contracts remain compatible. Private document uploads, payment processing and realtime transport are still separate work.

This project lives separately from the existing billing portal. All people and clinical content are fictional. Phase 1 has no database, server persistence, real authentication, email delivery, file storage, payment processing, video, realtime transport, or offline synchronization.

## Workspace

- `apps/web`: Next.js App Router, React, Tailwind 4, shadcn-style Radix primitives, Lucide, React Hook Form/Zod, Motion.
- `apps/mobile`: Expo Router, native React Native components, Uniwind/Tailwind 4, safe areas, native stack/bottom tabs, Reanimated.
- `packages/types`: organization, branches, profiles, assignments, clinical entities, appointments, permissions and repository contract.
- `packages/validation`: shared Zod input validation.
- `packages/permissions`: demonstration access policy.
- `packages/clinic-core`: slot generation, schedule conflicts, statuses, discovery mappings, display helpers.
- `packages/data-access`: typed synchronous mock repository and fictional fixtures. Both apps consume the same source; each app process has its own in-memory state.
- `packages/design-tokens`: brand colors, spacing and radii.
- `packages/config`: common strict TypeScript configuration.
- `supabase`: planning notes only. No SQL, migrations, credentials or SDK connection.

An external-store subscription refreshes the active application's views and notification inbox immediately. It is not cross-device realtime. Reload/restart resets the session. TanStack Query is intentionally deferred: there is no asynchronous server cache in Phase 1.

## Scheduling policy

The reproducible demo clinic day is **Monday, 26 October 2026**, in the future relative to project creation. All branch wall times use Asia/Karachi. A branch is an organization member; a doctor may have distinct schedules, durations and fees per branch. Slot conflicts are checked across all branches for the same doctor. Leave is doctor-wide.

- A new booking is pending approval and holds its slot. Admin or the assigned doctor can approve/reject it.
- A confirmed appointment can request a new time. Both old and proposed slots are held until approval. Approval atomically moves the appointment and releases the old time.
- Cancellation remains a request until Admin/assigned doctor approves. The slot then becomes available.
- Leave disables new slots and flags affected bookings for human resolution; there is no silent doctor reassignment. Checked-in or active consultations must be resolved first.
- No-show is an explicit clinician/admin action. Phase 2 should add a configurable grace period and an audited override.
- Check-in → in consultation → completed is the visit workflow. Signing requires diagnosis and treatment plan. Signed notes cannot be overwritten by the demo editor.
- Free consultations are waived. Paid consultations have manual paid/unpaid indicators; nothing is charged.
- Remote consultation is an appointment type only. Video and meeting-link integrations are deferred.
- Doctors/admin can register a fictional walk-in, then request an appointment through the same slot rules.

## Records and access

Baseline patient structure: name, date of birth, sex/gender, contact information, address, emergency contact, blood group, reported allergies, chronic conditions, medication list, surgical history, family and social history. Unknown/not recorded values must be distinguishable from a reviewed negative history.

Each encounter links branch, patient, appointment and author. It records presenting symptoms, BP, pulse, temperature, oxygen saturation, weight, height, examination findings, diagnosis, treatment plan, follow-up and draft/signed state. Prescriptions have medication, strength, dosage, frequency, duration and instructions. Documents have type, size, author, patient and optional encounter linkage. Phase 1 retains metadata only.

Admin sees all notes. Patients see their own records. Doctors see patients with an assigned appointment or explicit access grant. Admin can grant another doctor or authorized clinical staff access with a reason. The clinical staff profile demonstrates the permission model; there are three primary app personas. Client role switching is not real authorization.

## Phase 2 handoff

Replace the mock adapter with Supabase repositories; keep entities and validation shared. Add asynchronous query/cache hooks when server operations exist. Map organization/branch membership, appointment assignments and explicit record grants into RLS policies. Enforce slot reservations and transitions in transactional database functions with uniqueness/range constraints; client validation is insufficient for concurrency.

Implement invited-doctor onboarding with expiring one-use tokens, email/password auth, optional TOTP enrollment/recovery, audit trails, consent and account lifecycle. Enforce private storage policies and signed URLs for medical documents; scan and validate uploads server-side. Add idempotent notification/outbox delivery, scoped Supabase Realtime and native push. Define retention, clinical amendment, timezone conversion and recovery requirements with the client before production use.

Phase 2A now supplies a separately reviewed [local database foundation](database-architecture.md) with migrations, RLS and isolated security tests. Remote application still requires [explicit target/plan approval](migration-safety.md). No application adapter, real authentication or Phase 2B workflow has been implemented; the Phase 1 mock architecture above remains operational.
