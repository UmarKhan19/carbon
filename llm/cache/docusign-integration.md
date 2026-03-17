# DocuSign Integration

## Overview

DocuSign e-signature integration for sending purchase orders for electronic signature. Follows the same patterns as Jira, Linear, Xero, and other integrations in `@carbon/ee`.

## Package Structure

### Config (`packages/ee/src/docusign/config.tsx`)

- Uses `defineIntegration()` with OAuth config pointing to DocuSign demo environment
- Category: "Documents"
- Gated on `DOCUSIGN_CLIENT_ID` env var being set
- OAuth scopes: `signature`, `impersonation`
- SVG logo component included

### Client (`packages/ee/src/docusign/lib/client.ts`)

- `exchangeCodeForTokens(code, redirectUri)` - OAuth code exchange
- `refreshAccessToken(refreshToken)` - Token refresh
- `getUserInfo(accessToken)` - Get user info including account details
- `DocuSignClient` class:
  - `getAuthHeaders(companyId)` - Auto-refreshes tokens with 5-min buffer
  - `request<T>(companyId, path, options)` - Generic API request
  - `createEnvelope(companyId, input)` - Send document for signing
  - `getEnvelope(companyId, envelopeId)` - Get envelope status
  - `voidEnvelope(companyId, envelopeId, reason)` - Void an envelope
  - `resendEnvelope(companyId, envelopeId)` - Resend notification
  - `healthcheck(companyId)` - Verify integration is working

### Service (`packages/ee/src/docusign/lib/service.ts`)

- `getDocuSignIntegration(client, companyId)` - Query companyIntegration table
- `updateDocuSignCredentials(client, companyId, credentials)` - Update stored tokens
- `getDocuSignEnvelopeFromPurchaseOrder(client, companyId, purchaseOrderId)` - Get envelope mapping
- `linkPurchaseOrderToEnvelope(client, companyId, input)` - Store PO-envelope mapping
- `updateEnvelopeStatus(client, companyId, purchaseOrderId, status)` - Update cached status

### Types (`packages/ee/src/docusign/lib/types.ts`)

- `DocuSignCredentials` - OAuth tokens + account info
- `DocuSignEnvelopeStatus` - Possible envelope statuses
- `DocuSignEnvelopeResponse` - Create envelope API response
- `DocuSignEnvelopeDetails` - Full envelope details with recipients
- `DocuSignEnvelopeMapping` + Zod schema - Stored in externalIntegrationMapping metadata

## Environment Variables

- `DOCUSIGN_CLIENT_ID` - Integration key (also exposed to browser via getBrowserEnv)
- `DOCUSIGN_CLIENT_SECRET` - Secret key (server only)
- `DOCUSIGN_OAUTH_REDIRECT_URL` - OAuth redirect URL
- `DOCUSIGN_ACCOUNT_ID` - Account ID

## API Routes

- `GET /api/integrations/docusign/oauth` - OAuth callback, exchanges code for tokens, fetches user info, saves to companyIntegration
- `POST /api/integrations/docusign/send-signature` - Sends PO PDF to DocuSign for signing. Accepts: purchaseOrderId, signerName, signerEmail, emailSubject, emailBody, documentBase64, documentName
- `GET /api/integrations/docusign/status/:purchaseOrderId` - Checks signature status for a PO, refreshes from DocuSign API
- `POST /api/webhook/docusign/:companyId` - DocuSign Connect webhook handler. Validates HMAC-SHA256 signature via `x-docusign-signature-1` header using webhookSecret from integration settings. Parses envelope status changes, updates externalIntegrationMapping metadata. On "completed" status, triggers `process-signed-document` Trigger.dev task to download and store signed PDF.
- `GET /api/webhook/docusign/:companyId` - Health check endpoint for DocuSign Connect validation

## Trigger.dev Tasks

- `send-docusign-envelope` (`packages/jobs/trigger/send-docusign-envelope.ts`) - Creates and sends a DocuSign envelope for a PO, stores mapping in externalIntegrationMapping
- `process-signed-document` (`packages/jobs/trigger/process-signed-document.ts`) - Downloads signed PDF from DocuSign after envelope completion, uploads to Supabase Storage under same supplier-interaction path, creates document record

## UI Integration

### PurchaseOrderHeader.tsx

- "Request Signature" option added to Preview dropdown menu
- Only visible when DocuSign integration is active (`useIntegrations().has("docusign")`)
- Disabled when PO status is not one of: Planned, To Receive, To Receive and Invoice

### PurchaseOrderSignatureModal.tsx

- Shows either:
  - **Send form**: Signer name, email, subject, optional body message
  - **Status view**: When an envelope already exists, shows current status, signer info, dates
- Fetches PO PDF from `/file/purchase-order/{id}.pdf`, converts to base64, sends to DocuSign API route
- Uses `useFetcher` for both sending and status checking

## Database

### Migration (`20260316000000_add_docusign_integration.sql`)

- Inserts `docusign` row into `integration` table with empty JSON schema

### Storage

- Uses existing `companyIntegration` table for OAuth credentials (in metadata.credentials)
- Uses existing `externalIntegrationMapping` table with:
  - `entityType = "purchaseOrder"`
  - `integration = "docusign"`
  - `externalId = envelopeId`
  - `metadata` contains DocuSignEnvelopeMapping (envelopeId, status, signerName, signerEmail, subject, sentAt)
  - Webhook handler enriches metadata with: lastWebhookAt, completedAt, signedAt, voidedAt, voidedReason, declinedAt, declinedReason, signedDocumentPath, signedDocumentDownloadedAt

## Webhook Flow

1. DocuSign Connect sends POST to `/api/webhook/docusign/:companyId` with envelope status change
2. Handler validates HMAC-SHA256 signature using webhookSecret from companyIntegration.metadata
3. Payload parsed with `DocuSignWebhookPayloadSchema` (from `@carbon/ee/docusign`)
4. Entity looked up via `getEntityByEnvelopeId()` using the envelope ID
5. Mapping metadata updated with new status and timestamps
6. On "completed" status: `process-signed-document` task triggered
7. Task downloads signed PDF via `getDocuSignClient().getEnvelopeDocument()`, uploads to Supabase Storage, creates document record
