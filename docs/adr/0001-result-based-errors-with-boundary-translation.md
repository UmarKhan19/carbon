# Result-based errors with boundary translation

Status: accepted

Service-layer errors were untyped (generic `Error` or raw Supabase `PostgrestError` passthrough) and user-facing flash messages were hardcoded English, invisible to Lingui despite 11 supported locales. We decided that service functions return `Result<T, E>` (the `better-result` library, re-exported through `@carbon/result` as the sole import surface) where `E` is a tagged error carrying a Lingui `MessageDescriptor` plus interpolation values. Translation happens at the action boundary: the existing `error(err, i18n)` / `success(msg, i18n)` helpers in `@carbon/auth` accept a tagged error (or descriptor) plus the request-scoped i18n instance, resolve the descriptor in the requester's locale, and emit a `FlashResult` — so flash messages are translated at write time. The helpers keep their legacy `(value, string)` overload, so un-migrated call sites are unaffected.

## Considered Options

- **Per-app tag→message maps** (errors as pure data, each app owns an exhaustive `ErrorTag → MessageDescriptor` map): rejected because message authoring lands far from the error definition, every new error touches N app maps, and ERP/MES want identical wording ~95% of the time.
- **Translate at creation** (services receive a locale/i18n): rejected because it pollutes every service signature with presentation concerns.
- **Vendoring better-result**: rejected in favor of a pinned npm dependency; because all imports go through `@carbon/result`, vendoring later remains a one-day escape hatch.

## Consequences

- `@carbon/result` source must be in both Lingui catalog `include` lists (erp and mes) so class-level default messages extract.
- Error message descriptors and interpolation values must stay serializable.
- The six core errors (NotFound, Validation, Conflict, BusinessRule, Database, ExternalService) are a closed set; domain errors are defined next to the service that raises them. Supabase/Kysely → Result adapters live in `@carbon/database`, keeping `@carbon/result` dependency-free.
- Defects (panics, raw throws) deliberately bypass Result/flash and surface via the route ErrorBoundary — Result models expected failures only.
- Adoption follows the Greenfield Rule (see CONTEXT.md); the prior `Result` type in `@carbon/auth` is renamed `FlashResult` to free the name.
