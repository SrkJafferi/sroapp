# Initial repository publication review

3 November 2026. Target: `https://github.com/SrkJafferi/sroapp.git`, branch `main`. This review authorizes neither hosting deployment nor protected database operations.

## Initial Git state

The local repository had no commits, no configured remote and no tracked files. The approved remote returned no refs through a successful `git ls-remote`; no incompatible history was present. No reset, force push or historical rewrite was needed. Root workspace manifests and all shared packages were retained.

Local author identity was unset. The repository uses the verified GitHub owner's username and GitHub no-reply address, configured repository-locally; global Git identity was not changed.

## Exclusions and review

Real environment files, credentials/vaults, Supabase CLI temporary metadata, caches, dependencies, native build directories, APKs, database dumps, archived screenshots, local operational evidence, operator-recipient email tooling and the production catalog publication snapshot/transaction were excluded. Those local files were retained. The snapshot-specific local publication test is also excluded because it requires the private operational snapshot; generic database public-discovery tests remain included.

Environment examples contain names/placeholders only. Code, actual Web/mobile assets, shared packages, schema migrations/proposals, the root frozen pnpm lockfile and general architecture/environment guides are included. Existing fictional local fixtures are included; they are not production seeds and contain no real patient data. SQL bytes were compared between the Git index and working source and matched exactly, preserving approved migration hashes.

The review checked the actual staged Git blobs rather than assuming ignore rules remove committed content. Forbidden generated/configuration paths were absent. Exact known privileged local environment values were compared in memory against staged blobs and compiled browser assets; no matches were found and no values were printed. Operator/private contact markers were also checked and were absent from the staged set.

## Scanner and antivirus boundary

After the operator reported Bitdefender blocking the download route, that portable scanner was not run again. Bitdefender was never disabled, bypassed or given exclusions. Windows Package Manager confirmed **Gitleaks.Gitleaks 8.30.1** was already installed; subsequent scans used that installed Winget-linked executable. No antivirus settings or package installations were performed to work around the block.

Gitleaks scanned the staged files with full redaction and recursive decoding enabled. The remaining generic-api-key finding is **`authUserId` at `apps/web/lib/sro0009-recovery.ts:22`**, verified to be a UUID identifier for the existing fictional recovery scope, not a key, password, bearer token or handover secret. The module is server-only and its existing recovery gate remains unchanged. A duplicate metadata finding in the local recovery manifest was excluded with that operational snapshot. No blanket rule suppression, scanner baseline or hidden allow-comment was used to conceal findings. The raw scanner warning is retained in the ignored audit report and is not misrepresented as zero raw findings.

Security conclusion: **one reviewed UUID false positive; zero unresolved credential findings**. No prior local committed history existed. The new outgoing commit must additionally pass the full-history scan before push. Redacted scanner reports and detailed local index review are kept under ignored `artifacts/github-security/`, not in the repository.

## Build and deployment boundary

`pnpm install --lockfile-only --frozen-lockfile --ignore-scripts` passed using pinned pnpm 11.25.0; the lockfile hash remained unchanged. `SRO_ISOLATED_BUILD=1 pnpm --filter @sro/web build` passed compilation, TypeScript, page generation and route collection without applying migrations. The isolated output remains ignored. No application features or production credentials were changed.

The next authorized task is a separate Vercel import using `apps/web` and the existing shared workspace. See [the configuration handoff](github-vercel-preparation.md). No Vercel deployment, DNS change, email operation, Patient provisioning/reset, protected database mutation or Android APK build occurred during this GitHub task.
