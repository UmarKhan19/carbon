# Carbon

A manufacturing system comprising ERP, MES, and Academy (training) apps, built as a monorepo of `@carbon/*` packages.

## Language

### Error Handling

**Result**:
A typed success-or-failure value (`Result<T, E>`) returned by service functions, carrying either data or a tagged error.
_Avoid_: Using "Result" for flash payloads, Supabase responses, or `{ success: boolean }` shapes

**FlashResult**:
The payload of a flash message shown to the user after an action (`{ success, message, flash }`). Formerly named `Result` in `@carbon/auth`.
_Avoid_: Result (reserved for the typed Result)

**Flash**:
The session-cookie mechanism that carries a one-time FlashResult from an action to the next page render, surfaced as a toast.

**Core Error**:
One of a small closed set of cross-cutting error categories (not found, validation, conflict, business rule, database, external service) shared by all domains.
_Avoid_: Adding domain-specific errors to the core set

**Domain Error**:
An error specific to one module, defined alongside the service that raises it.

**Conflict**:
A failure where the operation is valid but the current state already blocks or satisfies it (e.g. "already clocked in").
_Avoid_: Business rule violation

**Business Rule Violation**:
A failure where the operation itself would violate a domain invariant (e.g. "insufficient quantity", "debits must equal credits").
_Avoid_: Conflict

**Greenfield Rule**:
The adoption policy for Result: new service functions and materially modified ones must return Result; untouched code keeps its existing style.
_Avoid_: Big-bang migration, mass rewrite
