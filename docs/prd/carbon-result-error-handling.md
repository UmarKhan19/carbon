# PRD: @carbon/result — typed, translatable error handling

> Design decisions and rejected alternatives are recorded in [docs/adr/0001-result-based-errors-with-boundary-translation.md](../adr/0001-result-based-errors-with-boundary-translation.md). Glossary terms (Result, FlashResult, Core Error, Domain Error, Conflict, Business Rule Violation, Greenfield Rule) are defined in [CONTEXT.md](../../CONTEXT.md). Full research notes live in [docs/research/carbon-result-package.md](../research/carbon-result-package.md).

## Problem Statement

When a service operation fails today, the failure is untyped and the message shown to the user is hardcoded English. Services return raw Supabase responses (`{ data, error }`) or throw generic `Error`s, so a caller can't tell "the record doesn't exist" apart from "the database write failed" without string-matching a message. The user-facing message is authored at the route, born in English, and never reaches the translation system — so despite supporting 11 locales, every error toast a user sees is in English.

Worse, several services pass the raw Supabase `PostgrestError` straight through to the action layer, which feeds it into the flash machinery. The result is that a raw Postgres string — e.g. "duplicate key value violates unique constraint …" — can surface directly in a user's toast: untranslated, meaningless to them, and leaking schema internals. There is no consistent boundary that turns a database failure into something safe and translatable.

As a developer, I can't handle failures exhaustively. As a non-English user, I get error messages I can't read. As any user, I sometimes get a raw technical database error I was never meant to see.

## Solution

Service functions return a typed Result (success-or-failure value) whose failure side is a tagged error carrying a translatable message. Each error knows what to say to the user as a Lingui message descriptor, defined once next to where the error is raised. At the boundary between server and user (the action layer), the error's message is translated into the requester's language and shown as the usual toast. Developers get exhaustive, typed failure handling where the logic lives; users get error messages in their own language; and the existing flash/toast experience is unchanged from the user's point of view — only now it speaks their language.

## User Stories

1. As a service author, I want a function to return a typed Result, so that callers know at compile time which failures can occur.
2. As a service author, I want to raise a NotFoundError with the entity and id, so that the "X not found" message is consistent without me writing it each time.
3. As a service author, I want to raise a ConflictError when the current state already blocks the operation (e.g. "already clocked in"), so that this is distinct from an invariant violation.
4. As a service author, I want to raise a BusinessRuleError when the operation itself violates a domain invariant (e.g. "insufficient quantity", "debits must equal credits"), so that the failure reason is semantically clear.
5. As a service author, I want a single import surface (`@carbon/result`) for the Result type and the core errors, so that I never reach for the underlying library directly.
6. As a service author, I want to convert a Supabase query into a Result with one adapter call, so that I don't hand-roll PostgrestError mapping at every call site.
7. As a service author, I want the adapter to require entity context when a "not found" is possible, so that a missing row produces a NotFoundError with a real message instead of a generic database failure.
8. As a service author, I want a Kysely transaction wrapper that turns thrown database exceptions into a DatabaseError, so that transactional services return a Result like everyone else.
9. As any user, I want a database failure to show me a safe, generic, translated message instead of a raw Postgres error string, so that I never see schema internals or untranslated technical text.
10. As an on-call developer, I want the raw PostgrestError preserved and logged when a DatabaseError is raised, so that I lose no debugging detail even though the user is shown a clean message.
11. As a service author, I want to chain several fallible database steps linearly, so that multi-step services read top-to-bottom instead of nesting error checks.
12. As a service author, I want to define a domain-specific error next to my service, so that its message lives near the code that raises it.
13. As a domain-error author, I want my error to extend the same translatable base as the core errors, so that it works with the boundary translation automatically.
14. As an action author, I want to convert a failed Result into a flash message with one call, so that the existing redirect/toast flow keeps working.
15. As an action author, I want the error message translated into the requester's locale at the moment the flash is written, so that the user reads it in their own language on the next render.
16. As a non-English user, I want error toasts in my language, so that I understand what went wrong.
17. As a developer, I want unexpected exceptions (defects) to keep surfacing through the route ErrorBoundary, so that real bugs stay loud instead of being disguised as polite toasts.
18. As a developer, I want the prior `Result` type in `@carbon/auth` renamed to `FlashResult`, so that the name "Result" unambiguously means the typed Result everywhere.
19. As a developer modifying an existing service, I want a clear rule (the Greenfield Rule) about when to adopt Result, so that I know whether to convert the function I'm touching.
20. As a developer reading an untouched legacy service, I want it to keep working unchanged, so that adoption doesn't require a risky mass rewrite.
21. As a translator, I want error messages extracted into the erp and mes catalogs, so that I can translate them like any other string.
22. As a reviewer, I want the approvals module converted end-to-end as a reference example, so that I can point others to a known-good pattern.
23. As a developer, I want the error message to have a sensible class-level default with an optional call-site override, so that raising an error is ergonomic but customizable when needed.
24. As a maintainer, I want `@carbon/result` to stay free of database and framework dependencies, so that it remains a stable leaf package.

## Implementation Decisions

- **New leaf package `@carbon/result`.** Depends on and re-exports the `better-result` library; this is the sole import surface for application code. The underlying library is never imported directly, keeping it swappable.
- **Translatable error base.** A TaggedError base wraps the library's tagged-error mechanism so each error instance carries a Lingui message descriptor (authored with the `msg` macro, which is safe outside React) plus serializable interpolation values. Errors define a class-level default message; call sites may override it.
- **Six Core Errors, closed set:** NotFoundError, ValidationError, ConflictError, BusinessRuleError, DatabaseError, ExternalServiceError. No PermissionError — permissions are enforced upstream by auth and row-level security before services run. The Conflict-vs-BusinessRule boundary follows the glossary: Conflict = operation valid but current state blocks/satisfies it; BusinessRule = operation itself violates an invariant.
- **Domain errors live with their service.** Module-specific errors extend the same translatable base and are defined next to the service that raises them. Module source is already within the translation extraction scope, so their messages extract without extra configuration.
- **Adapters live in `@carbon/database`, not in `@carbon/result`.** This keeps the result package free of Supabase/Kysely types. A query adapter maps the Supabase error shape to DatabaseError and the "no rows" condition to NotFoundError; it requires entity context whenever a not-found outcome is possible. A transaction wrapper maps thrown exceptions to DatabaseError. The adapters compose with the library's generator-style chaining so multi-step services read linearly. This replaces the current pattern where some services return the raw `PostgrestError` to the caller — after this work, no service hands a raw database error upward.
- **DatabaseError shows a generic message and preserves the raw error.** DatabaseError carries a generic, translatable default message (e.g. a "something went wrong saving" descriptor parameterized by the operation) — never the raw Postgres text. The original `PostgrestError` is retained on the error and logged when the error is raised, so on-call developers keep full debugging detail. The boundary converter, like today's `error()` helper, logs; the user only ever sees the generic translated message. This closes the leak where raw constraint-violation strings reached user toasts.
- **Boundary conversion lives in `@carbon/auth`, next to the flash machinery.** A converter takes a failed error plus a request-scoped i18n instance and returns a FlashResult, resolving the error's descriptor and values in the requester's locale at write time. A success counterpart mirrors it. This depends on `@carbon/result` and the Lingui core. The existing `error()`/`success()` helpers remain for unconverted legacy call sites.
- **Defects bypass the Result path.** Panics and raw throws are not converted to flash; they continue to the route ErrorBoundary. Result models expected, modeled failures only.
- **Translation extraction.** The result package source is added to both the erp and mes catalog include lists so class-level default messages are extracted.
- **Naming precursor.** The prior `@carbon/auth` `Result` type (`{ success, message, flash }`) is renamed `FlashResult` in a mechanical, type-position-only change across the repo before the new package lands.
- **Adoption follows the Greenfield Rule.** New service functions and materially modified ones return Result; untouched code keeps its existing style. The approvals module is converted end-to-end as the reference pilot.

The recommended landing order (each step independently shippable): rename to FlashResult → create `@carbon/result` and add it to both catalogs → adapters in `@carbon/database` → boundary converter in `@carbon/auth` → convert the approvals pilot and run extraction/translation → document the Greenfield Rule in AGENTS.md.

## Testing Decisions

A good test here verifies external behavior at the highest available seam and avoids asserting implementation details. The project uses Vitest via the shared config, `*.test.ts` naming, and explicit imports (no globals). Note that `@carbon/auth` and `@carbon/database` currently have no tests, so this work introduces their first test wiring.

- **`@carbon/result` core (new seam, pure unit tests).** Verify the translatable base produces the correct tag, carries the class-level default descriptor, honors a call-site override, and keeps values serializable; verify each of the six core errors. The library's own Result mechanics are not re-tested — only what Carbon adds on top. Prior art: the pure input→output style of the accounting utilities tests.
- **`@carbon/database` adapters (mocked query-chain seam).** Verify the query adapter's ok path, error-shape → DatabaseError, and no-rows → NotFoundError (with required entity context), and the transaction wrapper's throw → DatabaseError. Prior art: the traceability search route test already mocks Supabase query builders with `vi.fn()`. No live-database tests — consistent with the repo, which has none.
- **`@carbon/auth` boundary (converter seam).** Verify that the converter, given a real i18n instance loaded with a small inline test catalog, returns a translated message, marks the FlashResult as a failure, and preserves the legacy helper's logging behavior. Prior art: the existing i18n macro test that constructs a real i18n instance.
- **Approvals pilot (highest existing seam).** Service-function tests for the NotFound and Conflict paths with a mocked client. Prior art: the inspection-document-save service test. Translation coverage and the translated toast are verified manually (extraction run plus a browser walkthrough), not via new e2e automation.

## Out of Scope

- Converting all 20 service files. Only the approvals pilot is converted now; the rest follow the Greenfield Rule over time.
- Results crossing the server/client boundary. Results stop at the action layer; the client keeps using `t` macros directly. (Tagged-error instances do not survive JSON serialization as class instances, which is part of why.)
- Replacing or vendoring the underlying library. It stays a pinned npm dependency; vendoring remains a cheap future escape hatch because all imports already go through `@carbon/result`.
- A PermissionError category and any service-level permission re-checks.
- Changing the form validation error path (`validationError`); it is unaffected.
- Live-database integration tests for the adapters.

## Further Notes

- Small mechanics deliberately left to the implementer: exactly how the translatable base extends the library's tagged-error factory; the precise adapter signatures (list queries that cannot "not found" should not require entity context); whether the boundary converter logs to match the legacy helper's parity; and the pinned library version plus an ESM/TypeScript build compatibility check against the shared config.
- The only existing custom Error classes in the repo live in the enterprise accounting core and set the precedent for defining domain errors near their usage.
- Publishing target was deliberately not chosen: this PRD is a repo document, not a tracker issue. If it is later filed as an issue, confirm whether it belongs on the upstream tracker or the ZeroFarms fork first.
