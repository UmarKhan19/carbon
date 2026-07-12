# Extensibility and Upgrade-Safety Architecture

> Status: draft
> Author: carbon-agent (autonomous run — open questions resolved per spec-writing autonomous mode)
> Date: 2026-07-12

## TLDR

Carbon gets a platform-level extension architecture in which **the platform
owns schema and data integrity while extensions own behavior**. Extensions are
pnpm workspace packages that interact with core only through five sanctioned
surfaces: (1) named, versioned **hook extension points** (`before:` in-transaction
validation, `after:` async reaction), (2) semver'd **contract packages**
(`@carbon/contracts/*`) as the only importable API, (3) **manifest-declared
schema** generating real, typed, RLS'd Postgres side tables and namespaced
tables — never EAV, never ALTERs to core tables, (4) a **durable workflow
engine** (on the existing Inngest backbone) as the primary primitive for
multi-step processes, and (5) declared **UI slots and routes**. Module
isolation is enforced at lint, typecheck, and DB-role level. Upgrade safety is
an executable guarantee: contract tests in core CI plus a registry **corpus
gate** that runs every published extension's suite against each release
candidate, so `carbon upgrade` is a preflight-checked command, not a
consulting project. Prior art: open-mercato's (MIT) contract discipline,
applied to a deep ERP domain — see `.ai/research/extensibility-architecture.md`.

## Problem Statement

Carbon has no sanctioned way to extend the system without forking it. A shop
that needs a coating-inspection step on receipts today must fork
`apps/erp`, edit core receipt UI and services, and add migrations to the core
chain — and then resolve merge conflicts on every upgrade, forever. The only
in-product mechanism is the `customFields` JSONB column on core tables:
untyped, unindexed, no FK integrity, invisible to reporting, and incapable of
expressing behavior (validation, processes) at all.

Every mature open-source ERP forces the same choice — customize deeply and
dread every upgrade, or stay vanilla and lose the reason you chose open
source:

- **ERPNext:** `hooks.py` + monkey-patching + metadata-level Custom Fields.
  Nothing is versioned or contract-tested; customizations break silently on
  upgrade.
- **Odoo:** `_inherit` patches core models and tables in place. Extensions
  couple to core internals by construction; major upgrades are the famous
  multi-week consulting project, with a paid migration service to prove it.
- **open-mercato:** clean DI module contracts (the right idea) but a young,
  shallow domain, and only partial answers on schema extension and upgrade
  impact analysis.

If Carbon wants an extension ecosystem (customer-specific compliance flows,
vertical add-ons, integrations) it needs an architecture where extending and
upgrading are not in tension — and it needs it before ad-hoc customizations
calcify into de-facto contracts.

## Proposed Solution

One core bet: **the platform owns schema and data integrity; extensions own
behavior.** An extension never touches a core table, never patches a core
function, and never imports another module's internals. In exchange, the
platform guarantees that a green contract-test suite today means a green suite
after `carbon upgrade` tomorrow.

This is deliberately stricter than ERPNext or Odoo. The cost of writing an
extension is paid once, at build time, by the author — instead of on every
upgrade, forever, by every customer.

Three behavioral surfaces, in order of preference (authors reach for the
highest one that solves the problem):

| Surface | Use when | Guarantee |
|---|---|---|
| **Workflows** | Multi-step business process reacting to system events | Durable, retried, compensable |
| **Hooks** | Single-step reaction or validation at a lifecycle point | Schema-validated payload, ordered execution |
| **Service interfaces** | Extension code needs to read/act on core data | Typed, versioned, semver-guaranteed API |

### Hook-based extension points

Core modules **declare** named extension points (they are not discovered),
each with a stable name `{module}.{entity}.{transition}` (e.g.
`inventory.receipt.posted`, `quality.nonConformance.opened`) and a versioned
zod payload schema. Two phases:

- **`before:` hooks** — synchronous, in-transaction, deterministically ordered
  (manifest `priority`, then extension name). May **validate** (throw a typed
  `HookVeto` to abort the operation with a user-facing message) or **augment**
  (patch the extension's own side-table data — never core columns). Hard
  budget of 250ms per hook and no external I/O, enforced by the SDK runtime.
- **`after:` hooks** — asynchronous, at-least-once, delivered through the
  existing Inngest event system after commit. Free to do I/O, call services,
  start workflows. Must be idempotent; payloads carry a stable `eventId`.

Payload schemas are additive within a major version; a breaking change
requires a new point version, with the old version delivered via a
core-maintained adapter through the deprecation window. Hooks are registered
in the extension manifest, so the platform knows statically which extension
consumes which point at which version — the basis for upgrade impact reports.

### Contract packages and reading core data

Every core module publishes a **contract package** — the only importable
surface: `@carbon/contracts/inventory`, `@carbon/contracts/quality`, etc.
Contracts contain typed service interfaces, read-model types, extension-point
payload schemas, and error types. No implementation, no DB types, no Kysely.
Implementations are bound by a service registry at startup; extension code
receives services through `HookContext`/`WorkflowContext`, tenant-scoped by
construction (`companyId` injected from context, never passed by the caller).

Extensions never query core tables. Two sanctioned read paths: read models via
service interfaces (stable projections, so core can refactor columns freely),
and published SQL views (`contract."salesOrders_v1"`) for reporting/bulk
access.

### Schema extension without EAV

Every piece of extension data lives in a real, typed, platform-generated
Postgres table. Two shapes:

- **Entity augmentation — side tables.** Adding fields to a core entity
  generates a 1:1 side table keyed `(id, companyId)` to the core row with a
  composite FK and `ON DELETE CASCADE`. Core tables are never ALTERed;
  orphaned extension data is impossible. Declared augment fields auto-render
  at the entity's form slot.
- **New entities — namespaced tables** (`ext_{extension}_{table}`) with the
  full platform conventions: `id('prefix')`, `companyId`, composite PK, RLS,
  audit columns. Extensions get a scoped, typed Kysely client covering **their
  namespace only**, backed by a DB role with no grants outside it.

Authors do not write SQL. They declare schema in the manifest; `carbon ext
generate` diffs against the last generated version and emits a numbered,
immutable, checksummed migration into the extension package. The generator
statically rejects references to non-contract core relations, triggers on core
tables, and any ALTER outside the extension namespace — the generated SQL is
the only SQL an extension can ship.

### Module isolation at package boundaries

One rule: a module (core or extension) may import another module **only
through its contract package**. Enforced three times, because convention does
not survive contact with deadlines:

1. **Lint** — boundary rules: extension packages may import only
   `@carbon/extension-sdk`, `@carbon/contracts/*`, their own files, and
   declared npm deps; core modules get the mirror-image rule.
2. **Typecheck** — internal types are not exported from module barrels; the
   scoped Kysely client makes out-of-namespace table access a type error.
3. **Runtime** — the namespace-scoped DB role and tenant-scoped service
   registry make the first two non-bypassable even by dynamic code.

Extensions may depend on other extensions only if the dependency publishes its
own contract; the platform topologically orders install/migration/hook
execution by the declared graph and rejects cycles.

Everything an extension contributes is enumerable from its manifest: hooks,
workflows, schema, UI routes (`/x/{slug}/...`) and slots, permissions
(`{slug}_{action}`, managed by core RBAC), settings (rendered by core settings
UI), and crons. Notably absent by design: middleware on core routes, patching
core components, raw SQL, service overrides. If a real use case can't be
expressed, the answer is a new extension point in core — a PR, not a
workaround.

### Workflow engine as a first-class extension primitive

Most manufacturing extensibility needs are processes, not single steps:
"when a receipt posts for a coated part, create an inspection, notify quality,
wait for disposition, and on failure quarantine the lot and open an NCR."
Hand-rolling that with hooks means hand-rolling persistence, retries,
timeouts, and cleanup — the graveyard of every plugin ecosystem.

Workflows are TypeScript definitions (`defineWorkflow`) registered in the
manifest: a typed trigger (`on("inventory.receipt.posted", { filter })`),
named steps calling contract services, `waitForEvent`/`sleep` with timeouts,
and per-step saga-style compensators. The platform (executing on the existing
Inngest durable-execution backbone, not a bespoke runner) guarantees
durability (crash-resume, never restart), per-step retries with idempotency
keys, versioning (in-flight runs finish on the version they started),
observability (per-company, per-extension run/step/retry admin surface), and
tenancy (runs are companyId-scoped; triggers fire per company with the
extension enabled).

This is also the most upgrade-safe surface: a workflow touches core only
through events in and service calls out — both versioned contracts.

### Upgrade safety: contract tests and the corpus gate

What is versioned, and what a breaking change costs:

| Surface | Versioning | Breaking change requires |
|---|---|---|
| Extension-point payloads | Major version per point | New point version + adapter through deprecation window |
| Contract packages | Semver | Major bump + codemod/migration note |
| Extension SDK | Semver | Major bump, N−1 supported |
| Contract SQL views | Suffixed (`_v1`, `_v2`) | New view; old maintained through window |
| Workflow definitions | Per-workflow integer | In-flight runs pinned to their version |
| Extension schema | Per-extension integer | Forward-only migrations |

Deprecation policy: one major core release of continued function, structured
runtime warnings attributed to the consuming extension, and a release-note
entry with the replacement. This extends the existing
`BACKWARD_COMPATIBILITY.md` contract surfaces (FROZEN event types, STABLE
service signatures, ADDITIVE-ONLY schema) with mechanical enforcement.

Two executable suites: **platform-side** contract tests in core CI (payloads
match schemas at emission via golden fixtures per version; services behave per
contract including error contracts; a core PR changing behavior behind a
contract fails CI unless it bumps the version and adds the adapter), and
**extension-side** `carbon ext test` (a real ephemeral Postgres + platform
runtime: migrations from zero and from each historical version, golden
fixture events, workflow paths including timeout and compensation branches).

The decisive mechanism is the **corpus gate**: core CI maintains a registry
corpus of published extensions' manifests + contract tests (first-party
always; community opt-in). Every core release candidate gets a static pass
(diff every manifest against the RC's contract versions → machine-generated
impact report) and a dynamic pass (run every corpus suite against the RC). A
red corpus must produce a fix, an adapter, or an explicit breaking-changes
entry with remediation — silent breakage is the failure mode this
architecture exists to eliminate.

### Competitor comparison

Full findings: `.ai/research/extensibility-architecture.md`. Prior art
credit: open-mercato (MIT License, © 2025–2026 Open Mercato contributors,
<https://github.com/open-mercato/open-mercato>) — its DI module-contract
discipline is the closest existing implementation of the isolation model
proposed here.

| Dimension | ERPNext | Odoo | open-mercato | Carbon (this spec) |
|---|---|---|---|---|
| Extension mechanism | `hooks.py`, monkey-patching, server scripts | ORM `_inherit` — patch core in place | Clean DI module contracts | Declared hooks + versioned contracts; no override mechanism at all |
| Custom fields | DocType metadata (EAV-flavored) | ALTERs core tables via inheritance | Limited | Platform-generated typed side tables; core tables never touched |
| Extension migrations | Fixtures + patches, hand-maintained | Hand-maintained, breaks across versions | Basic | Generated from manifest, numbered, checksummed, platform-applied |
| Module isolation | Convention only | Effectively none | Good (package boundaries) | Enforced at lint + type + DB-role level |
| Upgrade safety | Manual; breaks routinely | Multi-week consulting project | Better, but young | Semver'd surfaces + deprecation windows + corpus contract tests per release |
| Process automation | Server scripts, basic workflow states | Automated/server actions (imperative) | — | First-class durable workflow engine (persistence, retries, `waitForEvent`, compensation) |
| Multi-tenancy in extensions | Site-per-tenant | DB-per-tenant or none | Row-level | Row-level, generated into every table + tenant-scoped services, non-optional |
| Static upgrade impact analysis | No | No | Partial | Yes — manifests make every dependency machine-readable |

One line: open-mercato's contract discipline, applied to a real ERP, with
schema extension solved structurally instead of via EAV, and upgrade safety
made an executable guarantee instead of a hope. The honest cost: a Carbon
extension takes more upfront learning than an Odoo patch. Accepted — "easy to
hack" and "easy to operate for a decade" are different products.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| H1: Multi-tenancy on new tables | Yes — every generated extension table and every platform table carries `companyId`, composite PK `("id", "companyId")`, `id('prefix')` default; generated, not author-written. Exception: `extensionMigration` and `extensionRegistry` are DB-level (schema is physical and shared across tenants), documented below. | Tenancy must be non-optional for third-party code; the generator is the only way it stays uniform. The two DB-level tables record facts about the database itself, not tenant data. |
| H2: Service shape | Platform-side service functions (install/enable/settings) follow the standard: `client` first arg, return `{ data, error }`, never throw, `companyId`-scoped. Contract services exposed to extensions are interface-based and tenant-scoped via context instead — they throw typed contract errors. | Core app code stays on Carbon conventions; the extension-facing surface needs typed errors and injected tenancy so extensions physically cannot pass a foreign `companyId`. |
| H3: RLS coverage | Every generated extension table gets the four standard policies (`SELECT` via `get_companies_with_employee_role()`, write policies via `get_companies_with_employee_permission('{slug}_{action}')`), emitted by the generator. Platform tables get the same hand-written per `.ai/rules/conventions-database.md`. | RLS on third-party tables cannot be left to authors; generation makes it a conformance-checkable invariant. |
| H4: Permission scoping | Extension permissions are `{slug}_{action}`, registered in core RBAC at install; extension routes call `requirePermissions` with them; permission scope strings remain FROZEN per `BACKWARD_COMPATIBILITY.md`. | Reuses the existing RBAC machinery end-to-end; no parallel permission system. Slug-derived naming prevents collisions with core module scopes. |
| H5: Form pattern | Declared augment fields auto-render in the core entity's form (zero extension UI code); extension-authored route forms use `ValidatedForm` + `validator(zodSchema)` + route actions like any Carbon form. | One form system; the manifest gives the platform enough type information to render augments without custom code. |
| H6: Module layout | N/A as stated for ERP modules — extensions are workspace packages under `extensions/{slug}` (package `carbon-ext-{slug}`), not `apps/erp/app/modules/*`. The analogous convention: one `manifest.ts` (single source of truth), optional `contract.ts`, `hooks/`, `workflows/`, `ui/`, `services/`, immutable `migrations/`, `AGENTS.md`. | The whole point is that extensions live outside the app at a package boundary; the ERP module layout governs core modules, which are unchanged. |
| H7: Backward compatibility | This spec touches no existing FROZEN/STABLE surface — it adds new ones. Contract packages, extension-point payloads, SDK, and contract views become versioned surfaces with the deprecation policy above; `BACKWARD_COMPATIBILITY.md` gains a section enumerating them. Existing `customFields` JSONB is untouched (see Open Questions). | Extensibility is only real if the new surfaces inherit — and mechanize — the existing compatibility contract rather than bypassing it. |
| Schema extension mechanism | Generated 1:1 side tables + namespaced owned tables; **no EAV, no JSONB growth, no ALTERs to core tables** | ERPNext's metadata fields and Odoo's in-place ALTERs are the two documented failure modes (see research); side tables give real types, FKs, indexes, and RLS with cascade-safe cleanup. |
| Override capability | None. Hooks can veto and augment; nothing can replace core behavior in place | The absence of an override mechanism is what makes upgrade guarantees possible; core fixes belong upstream (it's open source). |
| Extension SQL authoring | Authors declare schema in the manifest; `carbon ext generate` emits numbered, immutable, checksummed migrations; no hand-written SQL escape hatch | Every convention (naming, RLS, bare `NUMERIC`, tenancy) becomes generator-enforced instead of review-enforced. |
| Workflow backbone | Inngest (existing `@carbon/jobs` infrastructure), wrapped in a typed `defineWorkflow` SDK | Codebase precedent — durability, retries, and `waitForEvent` already exist in production; a bespoke runner would duplicate them. |
| Hook delivery | `before:` in-transaction (250ms budget, no I/O); `after:` via the event system, at-least-once, idempotent | Validation needs transactional veto; everything slow or fallible belongs on the durable async path. Mirrors the existing event-system split. |
| Isolation enforcement | Lint + typecheck + runtime DB role, all three | Any single layer is bypassable; the DB role is the backstop that holds even for generated/dynamic code. |
| Runtime placement (v1) | In-process with the app | Autonomous resolution — see Open Questions. |
| Dynamic/hot plugin loading | Out of scope for v1 — extensions are workspace packages resolved at build time | Manifest design keeps the door open; runtime loading adds sandboxing problems v1 doesn't need. |
| UI extension surface | Declared slots + namespaced routes only; no theming/patching of core screens | Arbitrary UI patching is the front-end version of `_inherit` — same upgrade coupling. |

## Data Model Changes

New platform tables (hand-written, in the core migration chain):

```sql
-- Which extensions are enabled for which company, with their settings.
CREATE TABLE "extensionInstall" (
    "id" TEXT NOT NULL DEFAULT id('extin'),
    "companyId" TEXT NOT NULL,
    "extensionSlug" TEXT NOT NULL,          -- e.g. 'coating-inspection'
    "version" TEXT NOT NULL,                -- installed extension version
    "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "settings" JSONB,                       -- values for the manifest's settings schema
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    CONSTRAINT "extensionInstall_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "extensionInstall_companyId_fkey" FOREIGN KEY ("companyId")
      REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "extensionInstall_unique" UNIQUE ("companyId", "extensionSlug")
);
CREATE INDEX "extensionInstall_companyId_idx" ON "extensionInstall" ("companyId");
ALTER TABLE "extensionInstall" ENABLE ROW LEVEL SECURITY;
-- Standard four policies per conventions-database.md:
-- SELECT via get_companies_with_employee_role();
-- INSERT/UPDATE/DELETE via get_companies_with_employee_permission('settings_<action>')

-- Applied extension migrations. DB-level by design (documented H1 exception):
-- schema is physical and shared across all tenants in the database.
CREATE TABLE "extensionMigration" (
    "id" TEXT NOT NULL DEFAULT id('extmg'),
    "extensionSlug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,             -- the extension's schema version
    "checksum" TEXT NOT NULL,               -- detects edited/tampered migration files
    "appliedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "extensionMigration_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "extensionMigration_unique" UNIQUE ("extensionSlug", "version")
);
-- RLS enabled, no permissive policies: service-role/installer access only.
ALTER TABLE "extensionMigration" ENABLE ROW LEVEL SECURITY;
```

Example of **generated** extension SQL (emitted by `carbon ext generate`,
never hand-written) — a side table augmenting `receiptLine`:

```sql
CREATE TABLE "ext_coatingInspection_receiptLine" (
    "id" TEXT NOT NULL,                     -- = receiptLine.id (1:1)
    "companyId" TEXT NOT NULL,
    "coatingSpec" TEXT,
    "cureTempC" NUMERIC,                    -- bare NUMERIC per conformance rules
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    CONSTRAINT "ext_coatingInspection_receiptLine_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "ext_coatingInspection_receiptLine_id_fkey" FOREIGN KEY ("id", "companyId")
      REFERENCES "receiptLine"("id", "companyId") ON DELETE CASCADE
);
-- + generated RLS (four standard policies on '{slug}_{action}' permissions),
-- + generated companyId index. Core tables are never ALTERed.
```

Extension-owned entity tables (`ext_{extension}_{table}`) follow the full
platform template (`id('prefix')`, `companyId`, composite PK, RLS, audit
columns), all generated. Uninstall offers **archive** (rename namespace to
`ext_removed_*`, revoke access — the default) or **drop** (destructive,
double-confirmed). Downgrade is unsupported; migrations are forward-only.

No changes to any existing core table.

## API / Service Changes

New packages:

- **`packages/extension-sdk/`** (`@carbon/extension-sdk`) — `defineExtension`
  (manifest schema + validation), `defineHook`/`HookVeto`, `defineWorkflow`/
  `step`/`waitForEvent`, `HookContext`/`WorkflowContext`, the scoped Kysely
  client factory, and the `carbon ext` test harness.
- **`packages/contracts/{module}/`** (`@carbon/contracts/*`) — per-module
  service interfaces, read models, extension-point payload schemas, error
  types. Types and zod only; no implementation.
- **`packages/extension-host/`** — service registry (binds contract
  interfaces to module implementations at startup, wraps calls with tenant
  scoping), hook dispatcher (`before:` in-transaction, `after:` via
  `@carbon/jobs` events), workflow runtime bindings, manifest loader,
  migration applier.

New CLI (`carbon ext`): `generate` (manifest diff → numbered migration),
`test` (ephemeral Postgres + runtime: migrations from zero and from each
prior version, golden fixtures, workflow branches), `publish` (registry +
corpus), `add` / `enable --company` (install + per-company enablement).

Core module changes: each module that publishes extension points emits them
at the declared lifecycle sites (e.g. `post-receipt` emits
`inventory.receipt.posted` with its versioned payload) and ships platform-side
contract tests. App services for the new platform tables live in a new
`extensions` settings module following the standard service shape (client
first, `{ data, error }`, `companyId`-scoped).

CI changes: boundary lint rules; corpus gate job on release candidates
(static impact report + dynamic corpus suite run).

## UI Changes

- **Settings → Extensions** page (ERP): installed extensions per company,
  enable/disable, manifest-driven settings forms (`ValidatedForm`), lossy-
  migration acknowledgments during upgrade, uninstall (archive/drop) flow.
- **Extension routes** mounted at `/x/{slug}/...`, built from `@carbon/react`
  components, gated by `{slug}_{action}` permissions.
- **UI slots** rendered by core screens at declared points — v1 inventory:
  entity detail panels, table columns, and action menus for the top ~10
  entities (see Open Questions). Declared augment fields auto-render on the
  entity's form.
- **Workflow observability** admin surface: runs, steps, retries,
  compensations per company and per extension, payloads redacted per the
  manifest's data classification.
- Deprecation warnings surfaced in the admin UI, attributed to the consuming
  extension.

## Acceptance Criteria

- [ ] A reference extension (`carbon-ext-coating-inspection`: one augment, one
      owned table, one `before:` hook, one workflow, one slot, one route)
      installs on a clean local stack via `carbon ext add` + `enable`, and
      `carbon ext test` passes its migrations from zero and from each prior
      schema version against a real ephemeral Postgres.
- [ ] Posting a receipt containing a coated part without a coating spec is
      aborted by the `before:` hook's `HookVeto`, the user sees the hook's
      message, and no receipt or ledger rows are written.
- [ ] Posting a valid coated receipt starts the inspection workflow; killing
      the app process mid-run and restarting resumes the run at the last
      completed step (no duplicate inspection is created).
- [ ] A workflow run parked on `waitForEvent` resumes when the matching
      `quality.inspection.dispositioned` event fires, and routes to its
      declared timeout handler when the timeout elapses.
- [ ] Every generated extension table has `companyId`, composite PK, the four
      standard RLS policies, and audit columns — verified by the
      `@carbon/checks` conformance suite with zero manual SQL edits.
- [ ] With two companies on one database and the extension enabled for only
      one, users of the other company see no extension UI, cannot read
      extension tables (RLS), and trigger no extension hooks or workflows.
- [ ] An extension source file containing
      `import ... from "~/modules/inventory/inventory.service"` or
      `import { Database } from "@carbon/database"` fails `pnpm run lint`;
      a query against a table outside the extension's namespace through its
      scoped client fails typecheck; the same query issued dynamically at
      runtime is rejected by the DB role.
- [ ] Editing a committed file under an extension's `migrations/` causes
      install/upgrade to fail with a checksum error.
- [ ] A core PR that changes an emitted extension-point payload without
      bumping the point version fails the platform-side contract tests in CI.
- [ ] The corpus gate, run against a release candidate that deprecates
      `inventory.receipt.posted@1`, produces an impact report naming every
      corpus extension consuming that point/version, and the RC still
      delivers v1 payloads through the adapter (reference extension's suite
      stays green with a deprecation warning).
- [ ] `carbon upgrade` preflight reports per-extension compatibility
      (compatible / compatible-with-deprecations / incompatible-with-
      available-update) before touching the database, and applies extension
      migrations after core migrations in dependency order.
- [ ] Uninstalling an extension with the default archive option renames its
      namespace to `ext_removed_*` and revokes access without deleting data;
      no core rows are affected.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Scope: this is a platform, not a feature — a serious build-out across SDK, host, contracts, CLI, and CI | High | Phase it: v1 = SDK + manifest + generated schema + hooks + isolation lint for 2–3 core modules' extension points, proven by the reference extension; workflows and corpus gate follow. `/plan` decomposes per phase. |
| Contract packages ossify core internals prematurely (whatever ships becomes semver-bound) | High | Publish contracts only for modules with a proven extension use case; keep read models as projections (not row shapes); start every contract at 0.x until the reference extension exercises it. |
| `before:` hooks in core transactions add latency and a new failure mode to hot posting paths | Med | 250ms budget + no-I/O enforcement in the SDK runtime; per-hook timing surfaced in the admin UI attributed to the extension; kill-switch: disabling an extension removes its hooks immediately. |
| Corpus gate becomes a release bottleneck (community suites red, flaky, or slow) | Med | Corpus red does not hard-block release — it forces a fix, adapter, or explicit breaking-changes entry; community suites run tiered (first-party gate, community report-only initially). |
| Scoped-role and generated-RLS mistakes could open cross-tenant access via extension tables | High | The generator is the single emitter of extension DDL (no hand SQL); conformance checks assert tenancy invariants on `ext_*` tables; the acceptance criteria include a two-company isolation test. |
| Workflow versioning/compensation semantics are subtle; wrong guarantees are worse than none | Med | Build on Inngest primitives already in production rather than a bespoke runner; `carbon ext test` must execute timeout and compensation branches, not just happy paths. |
| Coexistence confusion between `customFields` JSONB and side-table augments | Low | v1 positions them as different tools (ad-hoc per-company fields vs. packaged extensions); docs state the boundary; no forced migration (see Open Questions). |

## Open Questions

> HARD STOP: Do not proceed with implementation until these are answered.
>
> Autonomous run — no human was available; each question is resolved per the
> spec-writing skill's autonomous mode (codebase precedent → research
> consensus → recommended answer) and marked **Autonomous:**. These
> resolutions must be surfaced in the PR's "Assumed decisions" section for
> human review.

- [x] **Runtime placement — do extension hooks/workflows execute in-process
      with the app or in an isolated worker?** Why it matters: it sets the
      blast radius of a misbehaving extension (crash, memory, latency) and
      the cost of the v1 build. — **Autonomous:** in-process for v1.
      Codebase precedent: Inngest functions already execute in-process via
      `@carbon/jobs`, and `after:` hooks/workflows ride that path; `before:`
      hooks are budgeted (250ms, no I/O) and SDK-enforced. The manifest/
      contract design is placement-agnostic, so an isolated worker can be
      introduced later without contract changes. Out-of-process isolation in
      v1 would roughly double platform scope for a threat model (untrusted
      third-party code) that the initial first-party/reviewed corpus doesn't
      yet have.
- [x] **Which UI slots ship in v1?** Why it matters: every slot is a
      permanent compatibility surface on a core screen — too few and
      extensions can't build real UX, too many and core UI is frozen early. —
      **Autonomous:** entity detail panels, table columns, and action menus
      for the top ~10 extension-relevant entities (receipt/receipt line,
      shipment, sales order, purchase order, job/job operation, item,
      customer, supplier, quality issue), growing only by PR with a named use
      case. Research consensus: slot sprawl is how UI patching sneaks back
      in; a small, demand-driven inventory matches the "new capability = new
      extension point via PR" principle.
- [x] **What happens to the existing `customFields` JSONB feature once
      side-table augmentation ships?** Why it matters: production tables and
      live customer data are involved; a forced migration is Ask-First
      territory and a wrong story creates two competing mechanisms forever. —
      **Autonomous:** coexistence, no migration in v1. `customFields` remains
      the end-user, per-company, ad-hoc mechanism (a settings feature);
      side-table augments are the packaged-extension mechanism (a developer
      feature with types, FKs, and RLS). They serve different actors, so
      neither deprecation nor migration is forced. A future opt-in "promote
      custom field to extension field" tool is deliberately deferred —
      anything touching production data migration goes back to a human.
- [x] **Registry governance — what does a community extension need to enter
      the corpus (and thus influence release gating)?** Why it matters: the
      corpus gate's value depends on corpus quality; an unreviewed corpus
      makes releases hostage to broken third-party tests. — **Autonomous:**
      v1 corpus is first-party extensions only (always in, gating). Community
      extensions run report-only against RCs after an opt-in with a minimal
      bar: green `carbon ext test`, manifest lint, semver discipline. Full
      community governance (review process, gating status, revocation) is
      explicitly deferred to a follow-up spec once a community exists to
      govern.
- [x] **Do paid extensions integrate with the existing Stripe billing at the
      platform level in v1?** Why it matters: billing hooks shape the
      manifest (pricing metadata), the registry, and install/enable flows —
      retrofitting is expensive, but building it speculatively is scope. —
      **Autonomous:** out of scope for v1, recorded as an explicit deferral.
      No first-party extension needs it, and per `.ai/rules/billing-system.md`
      territory this crosses product-positioning questions a human must own.
      The manifest reserves an optional `pricing` block (ignored by v1
      tooling) so the registry format doesn't break when billing lands.

## Changelog

- 2026-07-12: Created from the extensibility architecture draft, restructured
  to the spec template. Autonomous run (no human available for the grill
  step): 5 open questions resolved per the spec-writing skill's autonomous
  mode and marked **Autonomous:** above — (1) in-process runtime for v1,
  (2) v1 UI slot inventory of detail panels/table columns/action menus for
  ~10 entities, (3) `customFields` coexistence with no forced migration,
  (4) first-party-only gating corpus with community report-only opt-in,
  (5) billing integration deferred with a reserved manifest `pricing` block.
  These require human review at the PR ("Assumed decisions" section).
