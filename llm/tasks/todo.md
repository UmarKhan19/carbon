# Task Plan

## Current Tasks

- [x] Research existing integration patterns (Xero/Jira/Linear/Slack)
- [ ] Add DocuSign env vars to `packages/auth/src/config/env.ts`
- [ ] Create `packages/ee/src/docusign/config.tsx` (integration definition)
- [ ] Create `packages/ee/src/docusign/lib/client.ts` (DocuSign API client)
- [ ] Create `packages/ee/src/docusign/lib/service.ts` (DB service layer)
- [ ] Create `packages/ee/src/docusign/lib/types.ts` (TypeScript types)
- [ ] Create `packages/ee/src/docusign/lib/index.ts` (barrel export)
- [ ] Update `packages/ee/src/index.ts` (register integration)
- [ ] Update `packages/ee/package.json` (add export)
- [ ] Create database migration for docusign integration
- [ ] Create `apps/erp/app/routes/api+/integrations.docusign.oauth.ts`
- [ ] Create `apps/erp/app/routes/api+/integrations.docusign.send-signature.ts`
- [ ] Create `apps/erp/app/routes/api+/integrations.docusign.status.$purchaseOrderId.ts`
- [ ] Create `apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderSignatureModal.tsx`
- [ ] Update `PurchaseOrderHeader.tsx` (add DocuSign button)
- [ ] Run lint and fix any issues
- [ ] Commit changes

## Review
