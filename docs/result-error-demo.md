# Demo: seeing every error and its translations

A hands-on way to verify the `@carbon/result` error messages and their
translations. See the design in
[docs/prd/carbon-result-error-handling.md](prd/carbon-result-error-handling.md).

## 1. The offline demo (no DB, no network)

```bash
pnpm --filter @carbon/result demo
```

This instantiates every core error (plus a domain-style override that mirrors
the approvals pilot) and resolves each one through the **same path
`errorFlash` uses** — so the output is exactly what a user would see in a toast.
It prints a table in English (the source / expected text), Spanish, and German,
and the assertions encode the "what's expected" spec.

### Expected output

```
  • NotFoundError  (id: error.notFound)
      en (expected): Approval request not found
      es           : Approval request no encontrado
      de           : Approval request nicht gefunden
  • ValidationError  (id: error.validation)
      en (expected): Validation failed
      es           : Error de validación
      de           : Validierung fehlgeschlagen
  • ConflictError  (id: error.conflict)
      en (expected): This action conflicts with the current state
      es           : Esta acción entra en conflicto con el estado actual
      de           : Diese Aktion steht im Konflikt mit dem aktuellen Zustand
  • ConflictError  (id: approvals.notPending)          ← call-site override (pilot)
      en (expected): Approval request is not pending
      es           : La solicitud de aprobación no está pendiente
      de           : Die Genehmigungsanfrage ist nicht ausstehend
  • BusinessRuleError  (id: error.businessRule)
      en (expected): This action is not allowed by a business rule
      es           : Esta acción no está permitida por una regla de negocio
      de           : Diese Aktion ist durch eine Geschäftsregel nicht erlaubt
  • DatabaseError  (id: error.database)                ← generic; raw error never shown
      en (expected): Something went wrong while saving your changes
      es           : Algo salió mal al guardar tus cambios
      de           : Beim Speichern Ihrer Änderungen ist etwas schiefgelaufen
  • ExternalServiceError  (id: error.externalService)
      en (expected): An external service is currently unavailable
      es           : Un servicio externo no está disponible actualmente
      de           : Ein externer Dienst ist derzeit nicht verfügbar
```

> The Spanish/German strings in the demo are hand-authored so it works offline.
> To populate the **real** catalogs for all 11 locales, run:
>
> ```bash
> pnpm lingui:extract   # picks up the msg() ids from packages/result/src + module *.errors.ts
> pnpm translate        # LLM-translates the new ids (needs network)
> pnpm lingui:compile
> ```

## 2. Verifying the translated toast in the running app (the approvals pilot)

The approvals service is converted end-to-end, so you can see a translated toast
in the real flash/redirect flow:

1. Start the ERP dev server and sign in.
2. Set your locale to Spanish (the `locale` cookie / account language) so
   `getRequestI18n` resolves `es`.
3. Trigger an approval failure, e.g. submit an approve/reject decision on a
   purchase order whose approval request is **not pending** (or no longer
   exists). The routes are:
   - `apps/erp/app/routes/x+/purchase-order+/$orderId.tsx`
   - `apps/erp/app/routes/x+/supplier+/$supplierId.approval.tsx`
   - `apps/erp/app/routes/x+/quality-document+/$id.tsx`
4. The toast shows the message in your locale (after a `translate` + `compile`).
   Without translated catalogs it falls back to the English source — the
   mechanism is identical; only the catalog content differs.

## What's covered

| Path                         | Where it's tested |
| ---------------------------- | ----------------- |
| Each core error's tag + default descriptor | `packages/result/src/errors.test.ts` |
| Translation + interpolation + override at the boundary | `packages/auth/src/utils/result.test.ts` |
| Supabase/Kysely → Result adapters | `packages/database/src/result.test.ts` |
| Approvals pilot NotFound + Conflict | `apps/erp/app/modules/shared/shared.service.test.ts` |
| All errors × locales (this demo) | `packages/result/src/demo.test.ts` |
