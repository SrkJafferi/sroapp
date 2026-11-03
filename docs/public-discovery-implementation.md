# Public discovery implementation and approval gate

> Publication update, 3 November: the separately approved selected-catalog transaction has now published the real 2-branch / 6-Doctor / 12-department directory. Both anonymous PostgREST and local Next feeds return 200 with identical populated data. See `public-discovery-deployment.md`; emulator and HTTPS/WebView verification limitations remain explicit there.

> Deployment update, 3 November 2026: the approved migration has now been applied and verified. No records have been published. See `public-discovery-deployment.md` for actual protected SQL/API results and the separately prepared selected-catalog publication transaction/hash. The sections below retain the original implementation evidence and pre-deployment observations.

2 November 2026. **Prepared locally, not deployed or client-ready.** Protected project: `jyigxpjvygvtvcypujel`; organization `88645fbe-34da-48aa-a509-c24441b7cf72`. Protected access during this task was read-only, apart from the CLI's temporary connection/login-role setup for its migration dry-run. No migration, publication, clinical write, Auth mutation, email or infrastructure change was executed.

## Approved visual rules

Retained unchanged: native Splash/animation, branding/background, native status bar, welcome/search composition, 20-scale-unit gap below welcome description, larger two-column categories (Branches / Doctors, Departments / Book appointment), frosted cards, and four bottom items **Home / Doctors / Bookings / Profile**. There is no Clinics bottom item. These latest direct instructions override the older five-item brief.

## Actual blocker and database inspection

The clinical tables have no public-listing consent/publication model. Their `active` flags authorize neither anonymous listing nor publication. Read-only inspection found 21 deployed migrations, two active branches, six active Doctors, and twelve department definitions. Existing RLS is membership/assurance scoped. Making those tables anonymous or using a clinical service-role snapshot would violate the requested boundary.

Known branches are SRO Rizvia Clinic and SRO Saddar Clinic. Doctors are Dr. Sara Malik, Dr. Ayesha Khan, Dr. Hina Farooq, Dr. Zara Imran, SRK Jaffri, and Dr. Nida Aftab. **None is implicitly approved for public listing.** Operators must explicitly select the branch/Doctor/department records to publish. Generic department definitions with no publicly listed Doctors may be published, but their association lists will be empty; no availability is inferred.

## Prepared migration: exact effects

`supabase/proposals/public-discovery/20261102180441_clinic_public_discovery.sql`

SHA-256: `c1a33decad2ce00fc55225c97ad4c08afa9e80c77201c9e06384b70a50106639`

Full SQL and machine-readable manifest are beside each other in that directory. The isolated bundle is `artifacts/public-discovery-deployment`. The candidate's bytes match the bundle.

1. Adds a non-exposed `clinic_discovery` schema and `publications` control table with organization-bound foreign keys, one-entity-per-row check, uniqueness, default unpublished state and approval timestamp. RLS is enabled and forced; no table permissions or policies are granted to anon/authenticated/service_role. Publication requires a separately approved operator operation. No rows are inserted by the migration.
2. Adds private-schema, fixed-empty-search-path, STABLE SECURITY DEFINER `clinic_discovery.read_feed(uuid)`. This deliberately anonymous public-catalog boundary reads only explicitly published active organizations/branches/Doctors and published departments. Doctor listing additionally requires a published department and an active assignment to a published branch. Revoking a branch/department also removes dependent Doctor listings. Output includes only IDs, names, branch location/address, specialty, department description and approved relationships. No patient, Auth, clinical, fee, schedule, contact email or phone fields are projected. No image/hour/location-coordinate/popularity claims are invented.
3. Adds a SECURITY INVOKER `public.get_public_discovery(uuid)` wrapper. Only named EXECUTE privileges and usage on the new dedicated schema are granted to anon/authenticated. PUBLIC execution is revoked. No existing table grants, RLS policies, functions or deployed migration files change. Direct access to the private reader cannot bypass its publication filter.

An empty publication control table gives genuine `version: 1` with three empty arrays. **It does not automatically publish all existing active records.** Listing approval and the exact publication transaction must be reviewed separately before data is exposed. Clinical read-only privileges are not broadened.

## Application implementation

- `apps/web/app/api/public/discovery/route.ts`: fixed organization; rejects query selectors; independent anonymous publishable-key Supabase client with no cookies, user JWT or service key; eight-second RPC timeout; bounded validated response; no-store/nosniff; supplemental per-process 60/minute limiter and safe 429/503 responses. Multi-instance production still needs shared edge rate limiting; forwarded client-IP trust must be configured at the actual hosting edge.
- `packages/data-access/src/public-discovery.ts`: pure shared DTO/parser/search contract, explicitly stripping unrelated fields, bounding inputs and restricting public image URLs to the approved HTTPS origin. Both Web and Expo consume it through the new `@sro/data-access/public-discovery` subpath. No mock fixture is imported by the public application.
- `apps/web/proxy.ts`: excludes this independent anonymous endpoint from session-refresh middleware. Existing clinical authorization remains intact.
- `apps/mobile/src/discovery/origin.ts`: only when `__DEV__` is true, optional `EXPO_PUBLIC_DISCOVERY_DEV_ORIGIN` accepts exactly `http://10.0.2.2:3100` or `:3101`. Paths, embedded credentials, query strings, fragments and other hosts/ports are rejected. Release calls ignore the override and use `https://app.sropk.org`. The protected WebView policy is unchanged and never uses this override. No .env file was modified.
- Native detail sheets now link approved branches to their associated public Doctors and vice versa; department details link associated clinics and Doctors. Search uses the same real public projection. Unknown filters remain unavailable with explanations. No generated clinic photography, fake schedules, geolocation or fixture fallback was added.
- `apps/web/lib/auth/discovery-intent.ts`, `app/auth/continue/route.ts`: only `book`, `appointments`, `profile`; stores navigation preference in an HTTP-only SameSite=Lax 30-minute cookie while unauthenticated/MFA/password-change completion is pending. Continuation rechecks the real authenticated session and trusted memberships, never a selected role. Fixed destinations open authorized appointments, settings, or the existing booking modal. The cookie is consumed after successful workspace resolution. No arbitrary redirects are accepted.
- Existing Auth login/MFA success and initial-password completion now use that guarded continuation. Invitation-specific navigation stays separate. `ClinicShell` consumes `book=1` only after identity and real clinical state are available, keeping the existing appointment workflow and server write authorization.

## Actual verification

- Local SQL/PGlite migration replay plus ten security cases passed: default deny, publication dependencies, field restriction, anonymous clinical denial, authenticated publication-write denial, organization FK denial, revocation, unchanged RLS policies, forced private RLS and fixed function search path. These are **local PostgreSQL engine tests, not remote JWT claims**.
- Final focused database/parser/navigation/auth-policy run: **25/25 passed**. Server-only recovery/email-boundary/limiter regressions: **4/4 passed**, using `node --conditions=react-server --import tsx --test tests/auth-server.test.ts`. The first attempt without `react-server` conditions correctly hit the existing server-only import guard; the corrected invocation passed without changing security boundaries or delivering email.
- Web and mobile TypeScript and targeted ESLint passed. Isolated Next production build passed. Android Hermes export passed: 4,061 modules / 46 assets, under `artifacts/discovery-functional/android-export`; **not an APK**.
- Existing installed Chrome was used in headless Playwright against the actual development app on port 3100: `/auth/login?intent=book` ended at clean `/auth/login`, retained an HTTP-only `book` cookie, and displayed the actual login form. An external intent remained at the local login origin. No credentials were entered or Auth accounts changed. Authenticated MFA/booking continuation still needs actual approved HTTPS end-to-end validation.
- Actual development `GET /api/public/discovery`: **503**, sanitized `Public clinic information is currently unavailable.` because approved public RPC is not deployed. Query injection attempt: **400**. Authenticated clinical endpoint requested anonymously with each valid role: **401** for all three. A bare clinical URL returned input validation 400, not data. Do not count the 503 as a working populated feed.
- CLI `db push --linked --dry-run --skip-vault --workdir artifacts/public-discovery-deployment`: **only `20261102180441_clinic_public_discovery.sql` pending**, no seeds/roles. Bundle contains the 21 historical migration files plus this candidate. Nothing was applied.
- Genuine existing Android 35 / Expo Go emulator evidence: `artifacts/discovery-functional/android-current.png` (1080×2400), plus UI XML. It confirms the retained two-column/four-nav layout but still displays the actual unavailable state. Expo Go/native development overlays are retained. **Populated branch/Doctor/department screenshots and real-data search/detail success are not claimed.**
- Automatic approval review rejected the Metro stop/restart command with reason only **“blocked by policy”**. It was not retried or bypassed. Existing Metro remains running, so its newly prepared development-origin setting has not been activated. The operator can stop the existing Metro and restart from `apps/mobile` with `$env:EXPO_PUBLIC_DISCOVERY_DEV_ORIGIN='http://10.0.2.2:3100'` and `node ../../node_modules/expo/bin/cli start --host lan --port 8086`. This permits only public discovery, never insecure WebView authentication.
- Inspected gate status without printing values: coordinated Patient access/mutations, walk-in pilot and SRO0009 recovery environment gates all OFF. No settings were changed. Historical SRO0007 constants are not new execution authorization and were not invoked.

## Domain and infrastructure

`https://app.sropk.org` still fails DNS resolution with **ENOTFOUND**. No `.vercel/project.json` in root or Web app, no root `vercel.json`, and no connected Vercel management tool were found. This proves the checkout is unlinked, not the state of the user's Vercel account.

After separate authorization: identify/link the intended Vercel project with root `apps/web` and the existing monorepo build; configure production origin `https://app.sropk.org` and securely scoped existing server/client environment names; add the domain using Vercel's actual prescribed DNS record (do not guess it); verify DNS, certificate, redirects, public feed and existing Auth allowed origins; then verify WebView login/MFA/password-change, cookie persistence, booking continuation and Android Back. No deploy, DNS, Auth settings or email configuration change was made now.

## Approval and recovery

Required next approval: apply the single candidate migration at the exact hash **and explicitly name which existing branches/Doctors/departments may be public**. The migration alone exposes an empty catalog. Prepare the exact ID-bound publication transaction for those choices before executing it; do not publish all active rows by assumption.

After approval: reverify target/hash/history and isolated dry-run, apply only the candidate; verify grants/advisors/anonymous REST projection and unchanged clinical denial; execute only the approved publication transaction; activate the dev-only public endpoint for emulator testing; capture populated genuine screens and test search/details/retry. Production WebView Auth remains blocked until separately approved HTTPS deployment.

Recovery: the DDL is transactional. On migration failure stop; do not reset. Before first publication the table is empty. After publication, the operator can revoke only the affected `published` rows (no clinical writes) to remove those listings and dependent relationships. Application endpoint fails closed on RPC/schema/network errors. Never use fake data to mask errors or destructively drop database objects to force success.

No release APK, protected Patient writes, provisioning/reset/recovery, migration application, production integration or infrastructure deployment occurred. **Next state is approval, not completion of live public discovery.**
