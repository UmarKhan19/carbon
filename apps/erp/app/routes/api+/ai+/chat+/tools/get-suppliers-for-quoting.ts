import { getAppUrl } from "@carbon/auth";
import { tool } from "ai";
import { LuUsers } from "react-icons/lu";
import { z } from "zod";
import { path } from "~/utils/path";
import type { ChatContext } from "../agents/shared/context";
import type { ToolConfig } from "../agents/shared/tools";

export const config: ToolConfig = {
  name: "getSuppliersForQuoting",
  icon: LuUsers,
  displayText: "Getting Suppliers for Quoting",
  message: "Searching for suppliers for quoting..."
};

export const getSuppliersForQuotingSchema = z.object({
  partIds: z
    .array(z.string())
    .describe("Part IDs to find suppliers for quoting")
});

export const getSuppliersForQuotingTool = tool({
  description:
    "Find all suppliers that carry given parts, including contact info for sending quote requests. Returns multiple suppliers unlike getSupplierForParts which returns only the best one.",
  inputSchema: getSuppliersForQuotingSchema,
  execute: async function (args, executionOptions) {
    const context = executionOptions.experimental_context as ChatContext;

    console.log("[getSuppliersForQuotingTool]", args);

    // Find suppliers that provide these parts and preferred suppliers
    const [supplierParts, preferredSuppliers] = await Promise.all([
      context.client
        .from("supplierPart")
        .select(
          "itemId, supplierId, unitPrice, supplierUnitOfMeasureCode, supplier(id, name)"
        )
        .in("itemId", args.partIds)
        .eq("companyId", context.companyId),
      context.client
        .from("itemReplenishment")
        .select("itemId, preferredSupplierId")
        .in("itemId", args.partIds)
        .eq("companyId", context.companyId)
    ]);

    if (!supplierParts.data || supplierParts.data.length === 0) {
      return { suppliers: [], message: "No suppliers found for these parts" };
    }

    // Build a set of preferred supplier IDs
    const preferredIds = new Set(
      preferredSuppliers.data
        ?.map((p) => p.preferredSupplierId)
        .filter(Boolean) ?? []
    );

    // Group by supplier, collecting all parts they carry
    const supplierMap = new Map<
      string,
      {
        supplierId: string;
        supplierName: string;
        isPreferred: boolean;
        parts: Array<{
          itemId: string;
          unitPrice: number | null;
          supplierUnitOfMeasureCode: string | null;
        }>;
      }
    >();

    for (const sp of supplierParts.data) {
      if (!sp.supplierId) continue;

      const existing = supplierMap.get(sp.supplierId);
      const partInfo = {
        itemId: sp.itemId,
        unitPrice: sp.unitPrice,
        supplierUnitOfMeasureCode: sp.supplierUnitOfMeasureCode
      };

      if (existing) {
        existing.parts.push(partInfo);
      } else {
        const supplier = sp.supplier as { id: string; name: string } | null;
        supplierMap.set(sp.supplierId, {
          supplierId: sp.supplierId,
          supplierName: supplier?.name ?? "Unknown",
          isPreferred: preferredIds.has(sp.supplierId),
          parts: [partInfo]
        });
      }
    }

    // Get contacts for each supplier (first contact with email)
    const supplierIds = Array.from(supplierMap.keys());
    const contacts = await context.client
      .from("supplierContact")
      .select("id, supplierId, contact(id, firstName, lastName, email)")
      .in("supplierId", supplierIds)
      .not("contact.email", "is", null);

    // Map contacts by supplierId (first with email)
    const contactMap = new Map<
      string,
      { contactId: string; contactEmail: string; contactName: string }
    >();
    for (const sc of contacts.data ?? []) {
      if (
        sc.supplierId &&
        !contactMap.has(sc.supplierId) &&
        sc.contact &&
        (sc.contact as any).email
      ) {
        const contact = sc.contact as {
          id: string;
          firstName: string | null;
          lastName: string | null;
          email: string;
        };
        contactMap.set(sc.supplierId, {
          contactId: sc.id,
          contactEmail: contact.email,
          contactName:
            [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
            "Unknown"
        });
      }
    }

    // Build result sorted by preferred first, then by number of matching parts
    const suppliers = Array.from(supplierMap.values())
      .sort((a, b) => {
        if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1;
        return b.parts.length - a.parts.length;
      })
      .map((s) => {
        const contact = contactMap.get(s.supplierId);
        return {
          supplierId: s.supplierId,
          supplierName: s.supplierName,
          isPreferred: s.isPreferred,
          link: `${getAppUrl()}${path.to.supplier(s.supplierId)}`,
          contactId: contact?.contactId ?? null,
          contactEmail: contact?.contactEmail ?? null,
          contactName: contact?.contactName ?? null,
          partsCarried: s.parts.length,
          unitPrice: s.parts[0]?.unitPrice ?? null,
          supplierUnitOfMeasureCode:
            s.parts[0]?.supplierUnitOfMeasureCode ?? null
        };
      });

    return { suppliers };
  }
});
