# Flow Canvas

Spec: `docs/BUILD_PLAN.md` (source of truth for scope, protocol, data model, milestones).

- pnpm monorepo. Node 22, pnpm 10. TypeScript strict everywhere.
- Shared contracts live in `packages/protocol` (wire messages, zod) and `packages/config` (flowcanvas.config.json schema + migrations). Never redefine these types elsewhere; import them. Change them only with tests.
- Packages are consumed as TS source (`main: ./src/index.ts`) inside the workspace; publishable packages (sdk, mcp) build with tsup.
- Before commit: `pnpm -r typecheck && pnpm -r test`.
