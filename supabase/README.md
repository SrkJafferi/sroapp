# Phase 2A database candidates — not applied remotely

`migrations/` contains three reviewed locally executable foundation candidates. `target-project.json` identifies the intended project; `remoteApplyApproved` remains false. `fixtures/fictional.sql` is local-test-only and must never be pushed as a production seed. No CLI project link, real Auth users, backend adapter or remote deployment is created here.

Run `pnpm check:db` for isolated PostgreSQL RLS/constraint tests and migration-derived type drift checks. See [architecture and RLS matrix](../docs/database-architecture.md), [initial plan](../docs/phase2a-plan.md), and [safety/approval/rollback and 2B handoff](../docs/migration-safety.md).

The existing Web/Android apps still use `packages/data-access` mock repositories. No database connection or migration is required to run them.
