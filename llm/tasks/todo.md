# Task Plan

## Completed Tasks

- [x] Research existing integration patterns (Xero/Jira/Linear/Slack)
- [x] Add DocuSign env vars to `packages/auth/src/config/env.ts`
- [x] Create `packages/ee/src/docusign/config.tsx` (integration definition)
- [x] Create `packages/ee/src/docusign/lib/client.ts` (DocuSign API client)
- [x] Create `packages/ee/src/docusign/lib/service.ts` (DB service layer)
- [x] Create `packages/ee/src/docusign/lib/types.ts` (TypeScript types)
- [x] Create `packages/ee/src/docusign/lib/index.ts` (barrel export)
- [x] Update `packages/ee/src/index.ts` (register integration)
- [x] Update `packages/ee/package.json` (add export)
- [x] Create database migration for docusign integration
- [x] Create `apps/erp/app/routes/api+/integrations.docusign.oauth.ts`
- [x] Create `apps/erp/app/routes/api+/integrations.docusign.send-signature.ts`
- [x] Create `apps/erp/app/routes/api+/integrations.docusign.status.$purchaseOrderId.ts`
- [x] Create `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderSignatureModal.tsx`
- [x] Update `PurchaseOrderHeader.tsx` (add DocuSign button)
- [x] Create Trigger.dev task `send-docusign-envelope` in `packages/jobs/trigger/send-docusign-envelope.ts`
- [x] Integrate DocuSign sending into `$orderId.finalize.tsx` (after PDF generation, trigger job)
- [x] Integrate DocuSign sending into `$orderId.tsx` approval action (after PDF generation, trigger job)
- [x] Run lint and fix any issues
- [x] Commit changes

## Review

All items completed. Lint passes (no new warnings introduced).
