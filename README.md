# SRO Clinic Management

SRO Clinic is a pnpm monorepo with a Next.js WebApp, Expo / React Native mobile application and shared TypeScript packages. The WebApp uses Supabase Auth, trusted role/branch memberships, RLS-protected clinical reads and secured transactional commands. The native entry flow provides Splash, public discovery and an HTTPS-only authentication WebView.

## Workspace

| Directory | Purpose |
| --- | --- |
| `apps/web` | Next.js App Router WebApp and server-side API routes |
| `apps/mobile` | Expo Router / React Native application |
| `packages/types` | Shared entity and repository contracts |
| `packages/validation` | Shared Zod validation |
| `packages/clinic-core` | Clinical workflow and display rules |
| `packages/permissions` | Shared permission helpers |
| `packages/data-access` | Adapters, public discovery contract and fictional local fixtures |
| `packages/design-tokens` | SRO colors, spacing and branding |
| `packages/config` | Shared TypeScript configuration |
| `supabase` | Reviewed SQL source, proposals and local-only fictional fixtures |
| `tests` | Targeted workflow, API, authorization and UI tests |

## Development

Use Node 22.13+ and pnpm 11.25.0, as declared in the root package manifest. Install from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm dev:web
```

Configure private local values using `apps/web/.env.example` and `apps/mobile/.env.example` as names-only templates. Actual `.env.local` files must never be committed. See [environment boundaries](docs/environment.md).

For mobile development, use `pnpm dev:mobile` and the existing Expo setup. The optional development public-discovery origin is never used by production authentication. Release authentication permits only `https://app.sropk.org`; that HTTPS WebApp must be deployed and verified separately. Prototype mock code remains for local fixtures/tests and is not a fallback for the client release.

## Verification

```powershell
pnpm --filter @sro/web build
pnpm --filter @sro/web typecheck
pnpm --filter @sro/mobile typecheck
pnpm check:core
```

Use targeted tests for the module being changed. `pnpm export:android` validates an Android JavaScript/assets export; it does not build an APK. Standalone APK creation requires separate authorization. Builds never apply Supabase migrations.

## Security and deployment

Clinical workflows use ordinary authenticated sessions and existing database authorization. Privileged identity operations stay server-only. Keep Patient provisioning, reset, pilot and recovery mutation gates disabled unless explicitly authorized. No real patient information belongs in fixtures or source control.

Local validation reports, screenshots, test evidence, credentials, operator-specific email tooling, deployment artifacts and Supabase CLI links are intentionally excluded from Git; the local files are retained. SQL bytes are preserved through Git checkout to protect approved migration hashes. Never execute historical live scripts or migration proposals as automatic deployment steps.

[GitHub/Vercel handoff](docs/github-vercel-preparation.md) describes the subsequent `apps/web` Vercel import, workspace build and private configuration. A GitHub push does not authorize hosting deployment, DNS changes or database operations.
