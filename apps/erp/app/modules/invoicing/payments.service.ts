import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  PaymentStatusType,
  paymentApplicationValidator,
  paymentValidator
} from "./payments.models";

// ----------------------------------------------------------------------
// Reads
// ----------------------------------------------------------------------

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
// panel on the sales/purchase invoice detail page to list every payment
// that has settled (any portion of) this invoice. Two-step query (apps
// then their parent payments) avoids the supabase JS type depth limit
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

// Open sales invoices for a customer (status active and a positive balance).
// Used by the application picker on the AR payment form.
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

// ----------------------------------------------------------------------
// Writes (Draft-only via RLS)
// ----------------------------------------------------------------------

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

export async function deletePayment(
  client: SupabaseClient<Database>,
  id: string
) {
  // RLS DELETE policy on payment table restricts to status='Draft'.
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

export async function deletePaymentApplication(
  client: SupabaseClient<Database>,
  id: string
) {
  // RLS DELETE policy requires parent payment.status='Draft'.
  return client.from("paymentApplication").delete().eq("id", id);
}

// Replace all applications for a Draft payment in a single call. RLS
// rejects this if the payment is not Draft; the rejection surfaces as
// an error on the delete (the delete won't happen but no inserts will
// either since the policy applies symmetrically).
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

// ----------------------------------------------------------------------
// Tie-out (calls the RPCs from migration 20260519140000_ar-ap-tie-out)
// ----------------------------------------------------------------------

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
