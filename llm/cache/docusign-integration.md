# DocuSign Integration

## Overview
The DocuSign integration allows users to request electronic signatures on purchase order PDFs directly from Carbon.

## Environment Variables

Required environment variables in `packages/auth/src/config/env.ts`:
- `DOCUSIGN_INTEGRATION_KEY` - OAuth integration key (client ID)
- `DOCUSIGN_SECRET_KEY` - OAuth secret key
- `DOCUSIGN_OAUTH_REDIRECT_URL` - OAuth callback URL
- `DOCUSIGN_ACCOUNT_ID` - DocuSign account ID

## Package Structure

```
packages/ee/src/docusign/
├── config.tsx           # Integration config with OAuth setup
├── lib/
│   ├── client.ts        # DocuSign API client
│   ├── service.ts       # Business logic for signatures
│   └── index.ts         # Exports
packages/ee/src/docusign.server.ts  # Server-side OAuth helpers
```

## Key Files

- **Config**: `/packages/ee/src/docusign/config.tsx`
- **Client**: `/packages/ee/src/docusign/lib/client.ts`
- **Service**: `/packages/ee/src/docusign/lib/service.ts`
- **OAuth Helpers**: `/packages/ee/src/docusign.server.ts`

## API Routes

- `GET /api/integrations/docusign/install` - Get OAuth install URL
- `GET /api/integrations/docusign/callback` - OAuth callback handler
- `POST /api/integrations/docusign/send-signature` - Send PO for signature
- `GET /api/integrations/docusign/status/:purchaseOrderId` - Get signature status

## UI Integration

The "Request Signature" option appears in the Preview dropdown on purchase order headers when:
1. DocuSign integration is installed/active
2. Purchase order status is "Planned", "To Receive", or "To Receive and Invoice"

Modal: `/apps/erp/app/modules/purchasing/ui/PurchaseOrder/PurchaseOrderSignatureModal.tsx`

## Database

Uses `externalIntegrationMapping` table:
- `entityType`: "purchaseOrder"
- `integration`: "docusign"
- `externalId`: DocuSign envelope ID
- `metadata`: Envelope details (status, signer info, etc.)

## Service Functions

- `sendPurchaseOrderForSignature()` - Send PO PDF to DocuSign
- `getSignatureStatus()` - Check envelope status
- `getDocuSignEnvelopeFromPurchaseOrder()` - Get envelope data
- `voidSignatureRequest()` - Cancel signature request
- `resendSignatureRequest()` - Resend envelope
