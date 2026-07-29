# API conventions (`api/`)

These apply to this NestJS/Prisma service specifically — see the root
`CLAUDE.md` for project-wide rules.

- Every new endpoint needs: unit test, integration test (real Postgres via
  Docker), and an OpenAPI/schema doc update.
- Schema changes always start as a Prisma migration file, never ad hoc SQL.
- Don't add new round-type-specific columns to `rounds` — use the
  `type_metadata` JSONB field (see `docs/DATA_MODEL.md` for examples).
