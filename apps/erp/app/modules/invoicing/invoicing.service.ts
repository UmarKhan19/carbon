import type { Database, Json } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import {
  getSupplierPayment,
  getSupplierShipping,
  insertSupplierInteraction
} from "~/modules/purchasing";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import { getCurrencyByCode } from "../accounting/accounting.service";
import { getEmployeeJob } from "../people/people.service";
import {
  getCustomerPayment,
  getCustomerShipping
} from "../sales/sales.service";
import type {
  PaymentStatusType,
  paymentApplicationValidator,
  paymentValidator,
  purchaseInvoiceDeliveryValidator,
  purchaseInvoiceLineValidator,
  purchaseInvoiceStatusType,
  purchaseInvoiceValidator,
  salesInvoiceLineValidator,
  salesInvoiceShipmentValidator,
  salesInvoiceStatusType,
  salesInvoiceValidator
} from "./invoicing.models";

export async function createPurchaseInvoiceFromPurchaseOrder(
  client: SupabaseClient<Database>,
  purchaseOrderId: string,
  companyId: string,
  userId: string
) {
  return client.functions.invoke<{ id: string }>("convert", {
    body: {
      type: "purchaseOrderToPurchaseInvoice",
      id: purchaseOrderId,
      companyId,
      userId
    }
  });
}

export async function createSalesInvoiceFromSalesOrder(
  client: SupabaseClient<Database>,
  salesOrderId: string,
  companyId: string,
  userId: string
) {
  return client.functions.invoke<{ id: string }>("convert", {
    body: {
      type: "salesOrderToSalesInvoice",
      id: salesOrderId,
      companyId,
      userId
    }
  });
}

export async function createSalesInvoiceFromShipment(
  client: SupabaseClient<Database>,
  shipmentId: string,
  companyId: string,
  userId: string
) {
  return client.functions.invoke<{ id: string }>("convert", {
    body: {
      type: "shipmentToSalesInvoice",
      id: shipmentId,
      companyId,
      userId
    }
  });
}

export async function deletePurchaseInvoice(
  client: SupabaseClient<Database>,
  purchaseInvoiceId: string
) {
  // Check if invoice is in Draft status before deleting
  const invoice = await client
    .from("purchaseInvoice")
    .select("id, status")
    .eq("id", purchaseInvoiceId)
    .single();

  if (invoice.error) {
    return invoice;
  }

  if (invoice.data.status !== "Draft") {
    return {
      data: null,
      error: {
        message: `Cannot delete purchase invoice with status "${invoice.data.status}". Only Draft invoices can be deleted.`,
        code: "INVOICE_NOT_DRAFT"
      }
    };
  }

  return client.from("purchaseInvoice").delete().eq("id", purchaseInvoiceId);
}

export async function deletePurchaseInvoiceLine(
  client: SupabaseClient<Database>,
  purchaseInvoiceLineId: string
) {
  return client
    .from("purchaseInvoiceLine")
    .delete()
    .eq("id", purchaseInvoiceLineId);
}

export async function deleteSalesInvoice(
  client: SupabaseClient<Database>,
  salesInvoiceId: string
) {
  // Check if invoice is in Draft status before deleting
  const invoice = await client
    .from("salesInvoice")
    .select("id, status")
    .eq("id", salesInvoiceId)
    .single();

  if (invoice.error) {
    return invoice;
  }

  if (invoice.data.status !== "Draft") {
    return {
      data: null,
      error: {
        message: `Cannot delete sales invoice with status "${invoice.data.status}". Only Draft invoices can be deleted.`,
        code: "INVOICE_NOT_DRAFT"
      }
    };
  }

  return client.from("salesInvoice").delete().eq("id", salesInvoiceId);
}

export async function deleteSalesInvoiceLine(
  client: SupabaseClient<Database>,
  salesInvoiceLineId: string
) {
  return client.from("salesInvoiceLine").delete().eq("id", salesInvoiceLineId);
}

export async function getPurchaseInvoice(
  client: SupabaseClient<Database>,
  purchaseInvoiceId: string
) {
  return client
    .from("purchaseInvoices")
    .select("*")
    .eq("id", purchaseInvoiceId)
    .single();
}

export async function getPurchaseInvoices(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("purchaseInvoices")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("invoiceId", `%${args.search}%`);
  }

  if (args.supplierId) {
    query = query.eq("supplierId", args.supplierId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "invoiceId", ascending: false }
  ]);
  return query;
}

export async function getPurchaseInvoiceDelivery(
  client: SupabaseClient<Database>,
  purchaseInvoiceId: string
) {
  return client
    .from("purchaseInvoiceDelivery")
    .select("*")
    .eq("id", purchaseInvoiceId)
    .single();
}

export async function getPurchaseInvoiceLines(
  client: SupabaseClient<Database>,
  purchaseInvoiceId: string
) {
  return client
    .from("purchaseInvoiceLines")
    .select("*")
    .eq("invoiceId", purchaseInvoiceId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });
}

export async function getPurchaseInvoiceLine(
  client: SupabaseClient<Database>,
  purchaseInvoiceLineId: string
) {
  return client
    .from("purchaseInvoiceLine")
    .select("*")
    .eq("id", purchaseInvoiceLineId)
    .single();
}

export async function getSalesInvoice(
  client: SupabaseClient<Database>,
  salesInvoiceId: string
) {
  return client
    .from("salesInvoices")
    .select("*")
    .eq("id", salesInvoiceId)
    .single();
}

export async function getSalesInvoiceCustomerDetails(
  client: SupabaseClient<Database>,
  salesInvoiceId: string
) {
  return client
    .from("salesInvoiceLocations")
    .select("*")
    .eq("id", salesInvoiceId)
    .single();
}

export async function getSalesInvoices(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    customerId: string | null;
  }
) {
  let query = client
    .from("salesInvoices")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("invoiceId", `%${args.search}%`);
  }

  if (args.customerId) {
    query = query.eq("customerId", args.customerId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "invoiceId", ascending: false }
  ]);
  return query;
}

export async function getSalesInvoiceShipment(
  client: SupabaseClient<Database>,
  salesInvoiceId: string
) {
  return client
    .from("salesInvoiceShipment")
    .select("*")
    .eq("id", salesInvoiceId)
    .single();
}

export async function getSalesInvoiceLines(
  client: SupabaseClient<Database>,
  salesInvoiceId: string
) {
  return client
    .from("salesInvoiceLines")
    .select("*")
    .eq("invoiceId", salesInvoiceId)
    .order("sortOrder", { ascending: true })
    .order("createdAt", { ascending: true });
}

export async function getSalesInvoiceLine(
  client: SupabaseClient<Database>,
  salesInvoiceLineId: string
) {
  return client
    .from("salesInvoiceLine")
    .select("*")
    .eq("id", salesInvoiceLineId)
    .single();
}

export async function updatePurchaseInvoiceExchangeRate(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    exchangeRate: number;
  }
) {
  const update = {
    id: data.id,
    exchangeRate: data.exchangeRate,
    exchangeRateUpdatedAt: new Date().toISOString()
  };

  return client.from("purchaseInvoice").update(update).eq("id", update.id);
}

export async function updatePurchaseInvoiceStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    status: (typeof purchaseInvoiceStatusType)[number];
    assignee: null | undefined;
    updatedBy: string;
  }
) {
  // Paid / Partially Paid / Overdue are derived in the purchaseInvoices view
  // from paymentApplication. Rejecting them here ensures status integrity.
  if (
    update.status === "Paid" ||
    update.status === "Partially Paid" ||
    update.status === "Overdue"
  ) {
    return {
      data: null,
      error: {
        message: `Cannot set status to ${update.status} directly — this status is derived from payment applications.`
      }
    };
  }

  return client.from("purchaseInvoice").update(update).eq("id", update.id);
}

export async function updateSalesInvoiceExchangeRate(
  client: SupabaseClient<Database>,
  data: {
    id: string;
    exchangeRate: number;
  }
) {
  const update = {
    id: data.id,
    exchangeRate: data.exchangeRate,
    exchangeRateUpdatedAt: new Date().toISOString()
  };

  return client.from("salesInvoice").update(update).eq("id", update.id);
}

export async function updateSalesInvoiceStatus(
  client: SupabaseClient<Database>,
  update: {
    id: string;
    status: (typeof salesInvoiceStatusType)[number];
    assignee: null | undefined;
    updatedBy: string;
  }
) {
  // Paid / Partially Paid / Overdue are derived in the salesInvoices view
  // from paymentApplication. Rejecting them here ensures status integrity.
  if (
    update.status === "Paid" ||
    update.status === "Partially Paid" ||
    update.status === "Overdue"
  ) {
    return {
      data: null,
      error: {
        message: `Cannot set status to ${update.status} directly — this status is derived from payment applications.`
      }
    };
  }

  return client.from("salesInvoice").update(update).eq("id", update.id);
}

export async function upsertPurchaseInvoice(
  client: SupabaseClient<Database>,
  purchaseInvoice:
    | (Omit<z.infer<typeof purchaseInvoiceValidator>, "id" | "invoiceId"> & {
        invoiceId: string;
        companyId: string;
        companyGroupId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof purchaseInvoiceValidator>, "id" | "invoiceId"> & {
        id: string;
        invoiceId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in purchaseInvoice) {
    return client
      .from("purchaseInvoice")
      .update({
        ...sanitize(purchaseInvoice),
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", purchaseInvoice.id)
      .select("id, invoiceId");
  }

  const [supplierInteraction, supplierPayment, supplierShipping, purchaser] =
    await Promise.all([
      insertSupplierInteraction(
        client,
        purchaseInvoice.companyId,
        purchaseInvoice.supplierId
      ),
      getSupplierPayment(client, purchaseInvoice.supplierId),
      getSupplierShipping(client, purchaseInvoice.supplierId),
      getEmployeeJob(
        client,
        purchaseInvoice.createdBy,
        purchaseInvoice.companyId
      )
    ]);

  if (supplierInteraction.error) return supplierInteraction;
  if (supplierPayment.error) return supplierPayment;
  if (supplierShipping.error) return supplierShipping;

  const { paymentTermId, invoiceSupplierId } = supplierPayment.data;

  const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
    supplierShipping.data;

  if (purchaseInvoice.currencyCode) {
    const currency = await getCurrencyByCode(
      client,
      purchaseInvoice.companyGroupId,
      purchaseInvoice.currencyCode
    );
    if (currency.data) {
      purchaseInvoice.exchangeRate = currency.data.exchangeRate ?? undefined;
      purchaseInvoice.exchangeRateUpdatedAt = new Date().toISOString();
    }
  } else {
    purchaseInvoice.exchangeRate = 1;
    purchaseInvoice.exchangeRateUpdatedAt = new Date().toISOString();
  }

  const locationId =
    purchaseInvoice.locationId ?? purchaser?.data?.locationId ?? null;

  const { companyGroupId: _companyGroupId, ...purchaseInvoiceData } =
    purchaseInvoice;

  const invoice = await client
    .from("purchaseInvoice")
    .insert([
      {
        ...purchaseInvoiceData,
        invoiceSupplierId: invoiceSupplierId ?? purchaseInvoice.supplierId,
        supplierInteractionId: supplierInteraction.data?.id,
        currencyCode: purchaseInvoice.currencyCode ?? "USD",
        paymentTermId: purchaseInvoice.paymentTermId ?? paymentTermId
      }
    ])
    .select("id, invoiceId");

  if (invoice.error) return invoice;

  const invoiceId = invoice.data[0].id;

  const delivery = await client.from("purchaseInvoiceDelivery").insert([
    {
      id: invoiceId,
      locationId: locationId,
      shippingMethodId: shippingMethodId,
      shippingTermId: shippingTermId,
      incoterm: incoterm,
      incotermLocation: incotermLocation,
      companyId: purchaseInvoice.companyId
    }
  ]);

  if (delivery.error) {
    await client.from("purchaseInvoice").delete().eq("id", invoiceId);
    return delivery;
  }

  return invoice;
}

export async function upsertPurchaseInvoiceDelivery(
  client: SupabaseClient<Database>,
  purchaseInvoiceDelivery:
    | (z.infer<typeof purchaseInvoiceDeliveryValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof purchaseInvoiceDeliveryValidator> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in purchaseInvoiceDelivery) {
    return client
      .from("purchaseInvoiceDelivery")
      .update(sanitize(purchaseInvoiceDelivery))
      .eq("id", purchaseInvoiceDelivery.id)
      .select("id")
      .single();
  }
  return client
    .from("purchaseInvoiceDelivery")
    .insert([purchaseInvoiceDelivery])
    .select("id")
    .single();
}

export async function upsertPurchaseInvoiceLine(
  client: SupabaseClient<Database>,
  purchaseInvoiceLine:
    | (Omit<z.infer<typeof purchaseInvoiceLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof purchaseInvoiceLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in purchaseInvoiceLine) {
    return client
      .from("purchaseInvoiceLine")
      .update(sanitize(purchaseInvoiceLine))
      .eq("id", purchaseInvoiceLine.id)
      .select("id")
      .single();
  }

  const existing = await client
    .from("purchaseInvoiceLine")
    .select("sortOrder")
    .eq("invoiceId", purchaseInvoiceLine.invoiceId);

  const maxSortOrder = (existing.data ?? []).reduce(
    (max, row) => Math.max(max, row.sortOrder ?? 0),
    0
  );

  return client
    .from("purchaseInvoiceLine")
    .insert([{ ...purchaseInvoiceLine, sortOrder: maxSortOrder + 1 }])
    .select("id")
    .single();
}

export async function updatePurchaseInvoiceLineOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("purchaseInvoiceLine")
        .set({ sortOrder, updatedBy })
        .where("id", "=", id)
        .execute();
    }
  });
}

export async function upsertSalesInvoice(
  client: SupabaseClient<Database>,
  salesInvoice:
    | (Omit<z.infer<typeof salesInvoiceValidator>, "id" | "invoiceId"> & {
        invoiceId: string;
        companyId: string;
        companyGroupId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof salesInvoiceValidator>, "id" | "invoiceId"> & {
        id: string;
        invoiceId: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in salesInvoice) {
    return client
      .from("salesInvoice")
      .update({
        ...sanitize(salesInvoice),
        updatedAt: today(getLocalTimeZone()).toString()
      })
      .eq("id", salesInvoice.id)
      .select("id, invoiceId");
  }

  const [opportunity, customerPayment, customerShipping, salesPerson] =
    await Promise.all([
      client
        .from("opportunity")
        .insert([
          {
            companyId: salesInvoice.companyId,
            customerId: salesInvoice.customerId
          }
        ])
        .select("id")
        .single(),
      getCustomerPayment(client, salesInvoice.customerId),
      getCustomerShipping(client, salesInvoice.customerId),
      getEmployeeJob(client, salesInvoice.createdBy, salesInvoice.companyId)
    ]);

  if (opportunity.error) return opportunity;
  if (customerPayment.error) return customerPayment;
  if (customerShipping.error) return customerShipping;

  const { paymentTermId, invoiceCustomerId } = customerPayment.data;
  const { shippingMethodId, shippingTermId, incoterm, incotermLocation } =
    customerShipping.data;

  if (salesInvoice.currencyCode) {
    const currency = await getCurrencyByCode(
      client,
      salesInvoice.companyGroupId,
      salesInvoice.currencyCode
    );
    if (currency.data) {
      salesInvoice.exchangeRate = currency.data.exchangeRate ?? undefined;
      salesInvoice.exchangeRateUpdatedAt = new Date().toISOString();
    }
  } else {
    salesInvoice.exchangeRate = 1;
    salesInvoice.exchangeRateUpdatedAt = new Date().toISOString();
  }

  const locationId =
    salesInvoice.locationId ?? salesPerson?.data?.locationId ?? null;

  const { companyGroupId: _companyGroupId, ...salesInvoiceData } = salesInvoice;

  const invoice = await client
    .from("salesInvoice")
    .insert([
      {
        ...salesInvoiceData,
        invoiceCustomerId: invoiceCustomerId ?? salesInvoice.customerId,
        opportunityId: opportunity.data?.id,
        currencyCode: salesInvoice.currencyCode ?? "USD",
        paymentTermId: salesInvoice.paymentTermId ?? paymentTermId
      }
    ])
    .select("id, invoiceId");

  if (invoice.error) return invoice;

  const invoiceId = invoice.data[0].id;

  const delivery = await client.from("salesInvoiceShipment").insert([
    {
      id: invoiceId,
      locationId: locationId,
      shippingMethodId: shippingMethodId,
      shippingTermId: shippingTermId,
      incoterm: incoterm,
      incotermLocation: incotermLocation,
      companyId: salesInvoice.companyId,
      createdBy: salesInvoice.createdBy
    }
  ]);

  if (delivery.error) {
    await client.from("salesInvoice").delete().eq("id", invoiceId);
    return delivery;
  }

  return invoice;
}

export async function upsertSalesInvoiceShipment(
  client: SupabaseClient<Database>,
  salesInvoiceShipment:
    | (z.infer<typeof salesInvoiceShipmentValidator> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (z.infer<typeof salesInvoiceShipmentValidator> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in salesInvoiceShipment) {
    return client
      .from("salesInvoiceShipment")
      .update(sanitize(salesInvoiceShipment))
      .eq("id", salesInvoiceShipment.id)
      .select("id")
      .single();
  }
  return client
    .from("salesInvoiceShipment")
    .insert([salesInvoiceShipment])
    .select("id")
    .single();
}

export async function upsertSalesInvoiceLine(
  client: SupabaseClient<Database>,
  salesInvoiceLine:
    | (Omit<z.infer<typeof salesInvoiceLineValidator>, "id"> & {
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof salesInvoiceLineValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("id" in salesInvoiceLine) {
    return client
      .from("salesInvoiceLine")
      .update(sanitize(salesInvoiceLine))
      .eq("id", salesInvoiceLine.id)
      .select("id")
      .single();
  }

  const existing = await client
    .from("salesInvoiceLine")
    .select("sortOrder")
    .eq("invoiceId", salesInvoiceLine.invoiceId);

  const maxSortOrder = (existing.data ?? []).reduce(
    (max, row) => Math.max(max, row.sortOrder ?? 0),
    0
  );

  return client
    .from("salesInvoiceLine")
    .insert([{ ...salesInvoiceLine, sortOrder: maxSortOrder + 1 }])
    .select("id")
    .single();
}

export async function updateSalesInvoiceLineOrder(
  db: Kysely<KyselyDatabase>,
  updates: { id: string; sortOrder: number; updatedBy: string }[]
) {
  return db.transaction().execute(async (trx) => {
    for (const { id, sortOrder, updatedBy } of updates) {
      await trx
        .updateTable("salesInvoiceLine")
        .set({ sortOrder, updatedBy })
        .where("id", "=", id)
        .execute();
    }
  });
}

// ======================================================================
// Payments (AR receipts + AP disbursements + applications)
// ======================================================================

export async function getPayment(client: SupabaseClient<Database>, id: string) {
  return client.from("payment").select("*").eq("id", id).single();
}

export async function getPayments(
  client: SupabaseClient<Database>,
  companyId: string,
  args: GenericQueryFilters & {
    search: string | null;
    paymentType: "Receipt" | "Disbursement" | null;
    status: PaymentStatusType | null;
    customerId: string | null;
    supplierId: string | null;
  }
) {
  let query = client
    .from("payment")
    .select("*", { count: "exact" })
    .eq("companyId", companyId);

  if (args.search) {
    query = query.ilike("paymentId", `%${args.search}%`);
  }
  if (args.paymentType) {
    query = query.eq("paymentType", args.paymentType);
  }
  if (args.status) {
    query = query.eq("status", args.status);
  }
  if (args.customerId) {
    query = query.eq("customerId", args.customerId);
  }
  if (args.supplierId) {
    query = query.eq("supplierId", args.supplierId);
  }

  query = setGenericQueryFilters(query, args, [
    { column: "paymentDate", ascending: false }
  ]);
  return query;
}

export async function getPaymentApplications(
  client: SupabaseClient<Database>,
  paymentId: string
) {
  return client
    .from("paymentApplication")
    .select("*")
    .eq("paymentId", paymentId)
    .order("appliedDate", { ascending: true });
}

export type PaymentApplicationForInvoice = {
  id: string;
  paymentId: string;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
  fxGainLossAmount: number | null;
  invoiceExchangeRate: number;
  paymentExchangeRate: number;
  appliedDate: string;
  payment: {
    id: string;
    paymentId: string;
    status: string | null;
    paymentDate: string | null;
    currencyCode: string;
  };
};

// Posted applications against a specific invoice. Used by the "Payments"
// panel on the sales/purchase invoice detail page. Two-step query (apps
// then their parent payments) dodges the supabase JS type depth limit
// that a !inner join hits, and lets the caller filter out Voided
// payments cleanly.
export async function getPaymentApplicationsForInvoice(
  client: SupabaseClient<Database>,
  side: "sales" | "purchase",
  invoiceId: string
): Promise<{
  data: PaymentApplicationForInvoice[] | null;
  error: unknown;
}> {
  const column = side === "sales" ? "salesInvoiceId" : "purchaseInvoiceId";
  const apps = await client
    .from("paymentApplication")
    .select(
      "id, paymentId, appliedAmount, discountAmount, writeOffAmount, fxGainLossAmount, invoiceExchangeRate, paymentExchangeRate, appliedDate"
    )
    .eq(column, invoiceId)
    .order("appliedDate", { ascending: false });

  if (apps.error) return { data: null, error: apps.error };
  if (!apps.data || apps.data.length === 0) return { data: [], error: null };

  const paymentIds = apps.data.map((a) => a.paymentId);
  const payments = await client
    .from("payment")
    .select("id, paymentId, status, paymentDate, currencyCode")
    .in("id", paymentIds)
    .eq("status", "Posted");

  if (payments.error) {
    return { data: null, error: payments.error };
  }

  const paymentById = new Map(payments.data.map((p) => [p.id, p]));
  const merged = apps.data
    .filter((a) => paymentById.has(a.paymentId))
    .map((a) => ({ ...a, payment: paymentById.get(a.paymentId)! }));

  return { data: merged, error: null };
}

// Open sales invoices for a customer (active status and a positive
// balance). Drives the apply table on the AR payment detail.
export async function getOpenSalesInvoicesForCustomer(
  client: SupabaseClient<Database>,
  companyId: string,
  customerId: string
) {
  return client
    .from("salesInvoices")
    .select(
      "id, invoiceId, dateDue, currencyCode, exchangeRate, totalAmount, balance, status"
    )
    .eq("companyId", companyId)
    .eq("customerId", customerId)
    .in("status", ["Submitted", "Partially Paid", "Overdue"])
    .order("dateDue", { ascending: true });
}

export async function getOpenPurchaseInvoicesForSupplier(
  client: SupabaseClient<Database>,
  companyId: string,
  supplierId: string
) {
  return client
    .from("purchaseInvoices")
    .select(
      "id, invoiceId, dateDue, currencyCode, exchangeRate, totalAmount, balance, status"
    )
    .eq("companyId", companyId)
    .eq("supplierId", supplierId)
    .in("status", ["Open", "Partially Paid", "Overdue"])
    .order("dateDue", { ascending: true });
}

export async function upsertPayment(
  client: SupabaseClient<Database>,
  payment:
    | (Omit<z.infer<typeof paymentValidator>, "id" | "paymentId"> & {
        paymentId: string;
        companyId: string;
        createdBy: string;
        customFields?: Json;
      })
    | (Omit<z.infer<typeof paymentValidator>, "id"> & {
        id: string;
        updatedBy: string;
        customFields?: Json;
      })
) {
  if ("createdBy" in payment) {
    return client
      .from("payment")
      .insert([sanitize(payment)])
      .select("id, paymentId")
      .single();
  }
  return client
    .from("payment")
    .update(sanitize(payment))
    .eq("id", payment.id)
    .select("id, paymentId")
    .single();
}

// RLS DELETE policy on payment restricts to status='Draft'.
export async function deletePayment(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("payment").delete().eq("id", id);
}

export async function upsertPaymentApplication(
  client: SupabaseClient<Database>,
  app:
    | (Omit<z.infer<typeof paymentApplicationValidator>, "id"> & {
        companyId: string;
        createdBy: string;
      })
    | (Omit<z.infer<typeof paymentApplicationValidator>, "id"> & {
        id: string;
      })
) {
  if ("createdBy" in app) {
    return client
      .from("paymentApplication")
      .insert([sanitize(app)])
      .select("id")
      .single();
  }
  return client
    .from("paymentApplication")
    .update(sanitize(app))
    .eq("id", app.id)
    .select("id")
    .single();
}

// RLS DELETE policy requires parent payment.status='Draft'.
export async function deletePaymentApplication(
  client: SupabaseClient<Database>,
  id: string
) {
  return client.from("paymentApplication").delete().eq("id", id);
}

// Replace-all for the apply table. RLS rejects this if the payment is
// not Draft; the rejection surfaces as an error on the delete.
export async function replacePaymentApplications(
  client: SupabaseClient<Database>,
  args: {
    paymentId: string;
    companyId: string;
    createdBy: string;
    applications: Omit<
      z.infer<typeof paymentApplicationValidator>,
      "id" | "paymentId"
    >[];
  }
) {
  const del = await client
    .from("paymentApplication")
    .delete()
    .eq("paymentId", args.paymentId);
  if (del.error) return del;

  if (args.applications.length === 0) {
    return { data: [], error: null };
  }

  return client.from("paymentApplication").insert(
    args.applications.map((a) => ({
      ...sanitize(a),
      paymentId: args.paymentId,
      companyId: args.companyId,
      createdBy: args.createdBy
    }))
  );
}

// Tie-out RPCs (migration 20260519140000_ar-ap-tie-out)

export async function getArTieOut(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate: string
) {
  return client
    .rpc("get_ar_tie_out", {
      _company_id: companyId,
      _as_of_date: asOfDate
    })
    .single();
}

export async function getApTieOut(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate: string
) {
  return client
    .rpc("get_ap_tie_out", {
      _company_id: companyId,
      _as_of_date: asOfDate
    })
    .single();
}

export async function getArOpenByCustomer(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate: string
) {
  return client.rpc("get_ar_open_by_customer", {
    _company_id: companyId,
    _as_of_date: asOfDate
  });
}

export async function getApOpenBySupplier(
  client: SupabaseClient<Database>,
  companyId: string,
  asOfDate: string
) {
  return client.rpc("get_ap_open_by_supplier", {
    _company_id: companyId,
    _as_of_date: asOfDate
  });
}
