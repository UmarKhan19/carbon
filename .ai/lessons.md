# Lessons Learned

Recurring patterns and mistakes to avoid. Review at session start for relevant tasks.

Format: `Context → Problem → Rule → Applies to`

---

## Docker group membership requires gateway restart

**Context:** Adding the openclaw user to the docker group for container access.

**Problem:** The running process inherits the old group list from its parent shell. The new group membership isn't visible until the process restarts.

**Rule:** Always restart the gateway (or any long-running service) after group membership changes. Don't assume the current process picks up new groups.

**Applies to:** Any systemd service or long-running process needing new group access.

## Binding format requires YAML frontmatter

**Context:** The conductor's `parseBinding()` function parses binding files for the inner loop.

**Problem:** `parseBinding()` only reads YAML frontmatter between `---` delimiters. When `title:` and `acceptance:` criteria were placed as markdown headings/checkboxes in the body (outside the frontmatter block), they were silently ignored.

**Rule:** `title:` and `acceptance:` list MUST be inside the `---` YAML frontmatter block, not as markdown headings or checkboxes in the body.

**Applies to:** `CARBON_AGENT.md`, all binding synthesis, `packages/harness/src/binding.ts`.

## `gh issue list` excludes PRs

**Context:** The heartbeat loop scans for assigned work using `gh issue list --assignee carbon-agent`.

**Problem:** GitHub's issue API excludes pull requests. Human-opened PRs assigned to carbon-agent (like PR #978 for ECOs) were invisible to the heartbeat — they don't appear in `gh issue list` results AND they don't appear in `gh pr list --author carbon-agent` because Brad authored them.

**Rule:** Always check BOTH `gh issue list --assignee` AND `gh pr list --assignee` when scanning for assigned work. PRs and issues are separate API surfaces.

**Applies to:** Heartbeat cron, `CARBON_AGENT.md`, agent-prompt.md.

## Orphaned claude subprocesses after OOM

**Context:** The harness parent process gets SIGKILL'd by the OOM killer during a build.

**Problem:** The `claude -p` doer subprocess survives because SIGKILL doesn't propagate to children. The judge may then run in degraded context (missing the doer's output) and revert good changes.

**Rule:** After a harness failure (especially OOM), check the worktree for untracked files to recover doer output before cleaning up. Don't assume a failed build left nothing useful behind.

**Applies to:** Post-failure recovery in conductor loop, `packages/harness/`.

## Permission scope renames are invisible to typecheck

**Context:** Renaming DB RLS policies (e.g., `plm_*` → `production_*`) as part of a module rename.

**Problem:** The app layer's `requirePermissions()` and `permissions.can()` calls use string literals like `"plm"`. These are invisible to TypeScript's type checker and linter — the rename passes all automated checks but 403s every route at runtime.

**Rule:** When renaming permission scopes, grep the ENTIRE codebase for all string literal references, not just the DB layer. Check `requirePermissions`, `permissions.can`, `usePermissions`, route loaders, and any conditional UI gating.

**Applies to:** Any permission or scope rename, `apps/erp/app/routes/`, `apps/erp/app/modules/`.

## Memory index requires force rebuild after embedding provider change

**Context:** The memory index was built with the wrong embedding provider.

**Problem:** Stale embeddings from the wrong provider don't match queries, making memory search return irrelevant results.

**Rule:** Run `openclaw memory index --force` whenever the embedding provider changes. Don't assume the old index is compatible.

**Applies to:** OpenClaw memory system configuration.

## smee.io SSE connections silently drop

**Context:** GitHub webhook relay uses smee.io for SSE-based event delivery.

**Problem:** The SSE connection can drop silently without the client detecting it. This caused a 30-minute gap in event delivery with no error logs.

**Rule:** Force periodic reconnection with `RuntimeMaxSec=900` on the systemd service, and maintain a polling fallback via `gh api` in the heartbeat to catch missed events.

**Applies to:** `smee-webhook.service`, heartbeat cron, webhook infrastructure.

## `crbn up --minimal` broken by docker-compose profile dependencies

**Context:** PR #979 added a `depends_on: meta` to the kong service.

**Problem:** The `meta` service was scoped to `profiles: ["full"]`, but kong needed it even in minimal mode. `crbn up --minimal` failed because docker-compose wouldn't start a `full`-profile service as a dependency of an unscoped service.

**Rule:** When adding `depends_on` in docker-compose, verify the dependency is available in ALL profiles where the dependent service runs. Don't assume a service is always available.

**Applies to:** `docker-compose.yml`, `packages/dev/`, `crbn up`.

## Multi-tenancy: every query must scope by companyId

**Context:** Writing service functions that query the database.

**Problem:** Forgetting to include `.eq("companyId", companyId)` in a query exposes cross-tenant data. RLS provides a safety net, but defense in depth requires application-level scoping too.

**Rule:** Every database query in a service function MUST include `companyId` scoping. Never rely solely on RLS for tenant isolation — treat it as a backup, not the primary guard.

**Applies to:** All `*.service.ts` files, any Kysely or Supabase query.

## Route actions must throw redirect on success, not return

**Context:** Writing form submission handlers in React Router route actions.

**Problem:** Using `return redirect(...)` instead of `throw redirect(...)` causes the redirect to be treated as data, not a navigation. The form stays on the page with stale state.

**Rule:** On success, route actions MUST use `throw redirect(path)`. On failure, use `return data({}, await flash(request, error(...)))`.

**Applies to:** All route action functions in `apps/erp/app/routes/`, `apps/mes/app/routes/`.

## ValidatedForm needs the validator, not the raw schema

**Context:** Building forms with zod validation.

**Problem:** Passing a raw zod schema to `ValidatedForm` instead of wrapping it with `validator()` from `@carbon/form` results in silent validation failures — the form submits without client-side validation.

**Rule:** Always use `validator(schema)` from `@carbon/form`, not the raw zod schema. Validate with `validator(schema).validate(formData)`, not `schema.parse()`.

**Applies to:** All forms in `apps/erp/app/routes/`, `packages/form/`.
