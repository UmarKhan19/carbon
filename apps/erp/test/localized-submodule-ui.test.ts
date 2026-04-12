import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "app");

const files = [
  "modules/sales/ui/Customers/CustomersTable.tsx",
  "modules/sales/ui/Quotes/QuotesTable.tsx",
  "modules/sales/ui/SalesRFQ/SalesRFQsTable.tsx",
  "modules/sales/ui/SalesOrder/SalesOrdersTable.tsx",
  "modules/sales/ui/Customer/CustomerHeader.tsx",
  "modules/sales/ui/Quotes/QuoteHeader.tsx",
  "modules/sales/ui/SalesRFQ/SalesRFQHeader.tsx",
  "modules/sales/ui/SalesOrder/SalesOrderHeader.tsx",
  "modules/sales/ui/SalesOrder/SalesOrderSummary.tsx",
  "modules/invoicing/ui/SalesInvoice/SalesInvoicesTable.tsx",
  "modules/invoicing/ui/PurchaseInvoice/PurchaseInvoicesTable.tsx",
  "modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceHeader.tsx"
];

const forbiddenPatterns: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /header:\s*"[^"]+"/g,
    description: "raw string table header"
  },
  {
    pattern: /pluralHeader:\s*"[^"]+"/g,
    description: "raw string plural header"
  },
  {
    pattern: /title="[^"]+"/g,
    description: "raw string title prop"
  },
  {
    pattern: /<New\s+label="[^"]+"/g,
    description: "raw string New label"
  },
  {
    pattern: />\s*Edit\s*</g,
    description: "raw Edit menu label"
  },
  {
    pattern: />\s*Delete\s*</g,
    description: "raw Delete menu label"
  },
  {
    pattern: /text=\{`Are you sure you want to delete[\s\S]*?This cannot be undone\.`\}/g,
    description: "raw delete confirmation text"
  },
  {
    pattern:
      /aria-label="(?:Toggle Explorer|More options|Toggle Properties)"/g,
    description: "raw header aria label"
  },
  {
    pattern: /<CardAttributeLabel>[^<{]+<\/CardAttributeLabel>/g,
    description: "raw card attribute label"
  },
  {
    pattern:
      />\s*(?:Delete Customer|Delete RFQ|Delete Quote|Delete Sales Order|Delete Purchase Invoice|Share|Preview|Finalize|Won|Lost|Cancel|Reopen|Ready for Quote|Quote|No Quote|Post|Payment|Purchase Order|Purchase Orders|Receipt|Receipts|Confirm|New Shipment|New Invoice|Shipments|Ship|Invoices|Invoice|Create Jobs|Edit Shipping|Add Shipping)\s*</g,
    description: "raw header action label"
  }
];

describe("localized sales and invoicing submodule UI", () => {
  test("avoids raw UI strings in localized table and header screens", () => {
    const offenders: string[] = [];

    for (const relativePath of files) {
      const source = readFileSync(join(root, relativePath), "utf8");
      const sanitizedSource = source.replace(/\/\*[\s\S]*?\*\//g, "");

      for (const { pattern, description } of forbiddenPatterns) {
        if (pattern.test(sanitizedSource)) {
          offenders.push(`${relativePath}: ${description}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
