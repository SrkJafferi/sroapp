# GitHub and Vercel handoff

Prepared 3 November 2026. This repository push does not authorize a Vercel deployment, DNS changes, database migrations, Patient provisioning or recovery operations.

## Repository contents and security

Version-controlled contents include both applications, shared packages, pnpm workspace/lockfile, reviewed SQL source and local fictional test fixtures. Actual environment files, dependencies, build caches, APKs, local CLI links, references, clinical/validation screenshots and operator-specific live evidence remain local and ignored. Historical reports and scripts containing operator inbox details are excluded from the publication set. The source is preserved locally; exclusions are not deletions.

`apps/web/.env.example` and `apps/mobile/.env.example` contain names/placeholders only. Real server credentials belong only in ignored Web environment files or encrypted server-side hosting configuration. Never copy service-role or Resend credentials to Expo or public-prefixed variables.

SQL has a `-text` Git attribute so checkout/newline conversion cannot invalidate already approved migration SHA-256 values. Migrations are not application build steps. Do not infer remote approval from a checked-in proposal, historical manifest or test script.

The current project contains server-only, explicitly gated recovery/pilot scopes for fictional operator-controlled identities. Identifiers are not passwords/tokens. Keep mutation/recovery gates OFF; never invoke historical live tooling as part of a build or deployment.

## Local verification

Use Node 22.13+ and the pinned pnpm 11.25.0 package manager. At repository root:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @sro/web build
```

The install/build scripts do not apply database migrations. Existing shared packages are linked through `workspace:*` dependencies and included in Next's `transpilePackages`. Expo remains a separate application; a Web build does not create an APK.

## Subsequent Vercel import — requires separate authorization

| Setting | Value |
| --- | --- |
| Git repository | `SrkJafferi/sroapp` |
| Root Directory | `apps/web` |
| Framework | Next.js |
| Node | 22.x, compatible with the existing engine requirement |
| Package manager | pnpm 11.25.0 from root `packageManager` via Corepack |
| Build Command | `pnpm build` from `apps/web` |
| Output Directory | Framework default `.next`; no isolated-test build flags |
| Shared files | Include workspace files outside the app root when that option is presented |

Use the repository-root workspace and lockfile. Enable Vercel's Corepack support (`ENABLE_EXPERIMENTAL_COREPACK=1` if required by the selected build image) rather than an unpinned install override that selects another pnpm version. Default workspace install or a pinned Corepack `pnpm install --frozen-lockfile` must execute with access to the repository workspace. No dependency upgrades are required for this handoff.

Set the exact names from the Web template privately in the Vercel server/client scopes. `SRO_APP_URL` must match the deployed HTTPS origin. The planned production origin is `https://app.sropk.org`; it must not be assumed accessible before DNS/TLS verification. Leave coordinated Patient access/mutations, walk-in pilot and SRO0009 recovery gates OFF, and do not set isolated/synthetic validation build flags in production. Existing Auth/session, origin and RLS requirements remain authoritative.

No environment values are stored in this guide. Provider/API configuration must be checked in the actual approved Vercel project during the next task. This local production build verifies compilation and workspace dependencies; it is not a cloud runtime, email, cookie or Auth-in-production sign-off.

Official references: [Vercel monorepos](https://vercel.com/docs/monorepos), [package-manager selection](https://vercel.com/docs/package-managers).
