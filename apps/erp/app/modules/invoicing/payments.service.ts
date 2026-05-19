import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  PaymentStatus,
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
    status: PaymentStatus | null;
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

// Tie-out fetchers (`getArTieOut`, `getApTieOut`) land with Task 6 when
// the RPCs themselves exist. Keeping them out of this file avoids a TS
// reference to an undefined RPC.
