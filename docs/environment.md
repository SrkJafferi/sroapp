# Environment setup and security

Web authentication uses real Supabase Auth and server-side Resend. Phase 2C Web clinical screens now read and write PostgreSQL through authenticated user sessions, RLS and secured commands; there is no Web mock fallback. Expo retains its existing mock repository. See [Phase 2C actual validation](phase2c-validation.md). Historical cleanup results below remain dated evidence.

## Web: `apps/web/.env.local`

Keep browser-safe Supabase configuration under these names:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

The legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` may also be present for compatibility. Public Supabase configuration must never contain a service-role or secret key.

Keep privileged credentials in the Web/server environment, without `NEXT_PUBLIC_` or `EXPO_PUBLIC_` prefixes:

```dotenv
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
SRO_APP_URL=
```

The blank examples above are names only; retain real values exclusively in ignored local files or the deployment's server-side secret configuration. When backend implementation is separately authorized, privileged access must remain inside server-only modules. Do not expose it through Next.js `env` configuration, client components, shared client packages, responses, logs or public assets.

`SRO_APP_URL` is the canonical Web origin, required for production. Use HTTPS outside localhost; development defaults to `http://localhost:3100`. `RESEND_FROM_EMAIL` must be `support@sropk.org`. Session cookies are HttpOnly/SameSite; Auth responses must not be cached by proxies/CDNs. The operator-generated demo Admin password is in an owner/SYSTEM-only vault outside the repository/webroot, never a client bundle or environment file. No existing environment values were changed during Phase 2B.

## Expo: `apps/mobile/.env.local`

This file must contain **only**:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

Both values must be non-empty. `NEXT_PUBLIC_` names do not replace Expo's public names. Do not copy Web/server environment files into the mobile app. Service-role keys, Resend API keys, database URLs/passwords and other privileged credentials must not be placed in this file, Expo `extra`, app configuration, Metro environment serialization or native bundles. Future mobile email/administrative operations must call an authorized backend.

## Local file handling

- `.gitignore` excludes `.env*` everywhere except intentionally safe `.env.example` files. Actual `.env.local` files must also remain untracked; ignore rules do not remove a previously tracked file.
- A repository-root `.env.local` also exists locally. It was left unchanged; use app-specific files for each app and never copy its server credentials into Expo.
- Inspect names and non-empty status without printing values. Avoid environment dumps, shell tracing and diffs of credential files.
- Do not rotate credentials during routine cleanup. If exposure is confirmed, report locations without values and obtain approval before rotation.
- Do not rebuild the standalone APK for environment documentation or presence checks. Native release validation requires a separate request or milestone.

## Verified cleanup — 25 October 2026

The current mobile file already contained only the two approved Expo variables when inspected. Both are non-empty. Web public Supabase variables and its service-role, Resend API and sender variables are non-empty; the Web file was preserved byte-for-byte. No public-prefixed privileged values were detected.

The local audit found no privileged environment references in application/shared source or Expo configuration, and no matching secret values in 86 inspected source/documentation files, 103 existing Web/native bundle files, or all 1,194 entries of the existing APK. Both APK copies have the original SHA-256, `37276F23FC3974EAC30447E09CF389ABA347D3E7F62F5A7B0B006EDAC95B6381`; nothing was rebuilt.

Web, mobile and repository-root `.env.local` files are Git-ignored and untracked. Available refs/reflogs contain **zero commits**, so no local committed-secret exposure was found. This audit cannot establish the state of deleted/remote history, previously distributed artifacts or external services. It checked local references and literal secret values, not credential validity or arbitrary secret encodings.

Secret-free audit metadata is stored locally in ignored `artifacts/env-security/report.json`. No credentials were rotated, no application features changed, and no workflow tests, migrations or backend implementation were run.

## Active profile/avatar integration

The profile/avatar migration `20261026192535` was approved by exact SHA-256 and applied; it adds private bucket `clinic-profile-avatars` and scoped commands. See [deployment review and result](profile-avatar-validation.md). No new environment variables or credential changes are required. The existing server-only service credential is limited in this workflow to `attest_profile_avatar`, which validates a pinned pending object after server-side processing and authenticated byte verification. Ordinary profile mutations, Storage transfers and reads use the verified user's session. Resend and Expo configuration are untouched. Do not expose this credential through `NEXT_PUBLIC_`/`EXPO_PUBLIC_`, shared client modules, image URLs or logs. Temporary production validation uses a child-process origin override; it never edits `.env.local`.
