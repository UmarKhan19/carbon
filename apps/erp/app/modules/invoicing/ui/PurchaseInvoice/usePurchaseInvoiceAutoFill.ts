import { useCarbon } from "@carbon/auth";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { flushSync } from "react-dom";
import type { z } from "zod";
import type {
  ExtractedDocumentData,
  PurchaseInvoiceExtraction,
  PurchaseInvoiceLineItem
} from "~/modules/documents";
import {
  findMatchingContactId,
  findMatchingLocationId,
  getExtractionMatchCandidates
} from "~/modules/documents";
import type { purchaseInvoiceValidator } from "~/modules/invoicing";

type PurchaseInvoiceFormValues = z.infer<typeof purchaseInvoiceValidator>;

type ExtractedAddress = {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateProvince?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
};

type InvoiceSupplierState = {
  id: string | undefined;
  invoiceSupplierContactId: string | undefined;
  invoiceSupplierLocationId: string | undefined;
  currencyCode: string | undefined;
  paymentTermId: string | undefined;
};

/**
 * Owns the PDF auto-fill orchestration for the Purchase Invoice form: resolving
 * the extracted supplier/contact/location/payment-terms/currency against existing
 * records, stashing unmatched values for create-on-the-fly, and re-keying the form
 * with resolved defaults. Keeps this logic out of the presentational form.
 */
export function usePurchaseInvoiceAutoFill(
  initialValues: PurchaseInvoiceFormValues
) {
  const { t } = useLingui();
  const { carbon } = useCarbon();

  const [invoiceSupplier, setInvoiceSupplier] = useState<InvoiceSupplierState>({
    id: initialValues.invoiceSupplierId,
    invoiceSupplierContactId: initialValues.invoiceSupplierContactId,
    invoiceSupplierLocationId: initialValues.invoiceSupplierLocationId,
    currencyCode: initialValues.currencyCode,
    paymentTermId: initialValues.paymentTermId
  });
  const [supplier, setSupplier] = useState<{ id: string | undefined }>({
    id: initialValues.supplierId
  });

  const [extractedSupplierName, setExtractedSupplierName] = useState<string>();
  const [extractedContactName, setExtractedContactName] = useState<string>();
  const [extractedContactEmail, setExtractedContactEmail] = useState<string>();
  const [extractedContactPhone, setExtractedContactPhone] = useState<string>();
  const [extractedAddress, setExtractedAddress] = useState<ExtractedAddress>();
  const [extractedLineItems, setExtractedLineItems] = useState<
    PurchaseInvoiceLineItem[]
  >([]);
  const [extractedTaxAmount, setExtractedTaxAmount] = useState<number>(0);
  const [extractedStoragePath, setExtractedStoragePath] = useState<string>();

  const [formKey, setFormKey] = useState(0);
  const [currentValues, setCurrentValues] = useState(initialValues);

  const handleExtractionComplete = async (raw: ExtractedDocumentData) => {
    const data = raw as PurchaseInvoiceExtraction & {
      _storagePath?: string | null;
    };

    let resolvedSupplierId = currentValues.supplierId;
    let resolvedPaymentTermId = currentValues.paymentTermId;
    let resolvedCurrencyCode = currentValues.currencyCode;

    let foundSupplierInDb = false;
    let resolvedContactId: string | undefined = undefined;
    let resolvedLocationId: string | undefined = undefined;

    if (carbon) {
      if (data.supplierName) {
        const { data: supplierData } = await carbon
          .from("supplier")
          .select("id, currencyCode")
          .ilike("name", `%${data.supplierName.trim()}%`)
          .limit(1);

        if (supplierData && supplierData.length > 0) {
          resolvedSupplierId = supplierData[0].id;
          resolvedCurrencyCode =
            supplierData[0].currencyCode ?? resolvedCurrencyCode;
          foundSupplierInDb = true;
        }
      }

      if (data.paymentTerms) {
        const { data: termData } = await carbon
          .from("paymentTerm")
          .select("id")
          .ilike("name", `%${data.paymentTerms}%`)
          .limit(1);

        if (termData && termData.length > 0) {
          resolvedPaymentTermId = termData[0].id;
        }
      }

      if (resolvedSupplierId) {
        const { contacts, locations } = await getExtractionMatchCandidates(
          carbon,
          "supplier",
          resolvedSupplierId
        );

        resolvedContactId = findMatchingContactId(contacts, {
          name: data.supplierContactName,
          email: data.supplierContactEmail
        });
        resolvedLocationId = findMatchingLocationId(
          locations,
          data.supplierAddressLine1
        );
      }
    }

    if (data.currencyCode) {
      resolvedCurrencyCode = data.currencyCode;
    }

    if (
      (data.supplierContactName || data.supplierContactEmail) &&
      !resolvedContactId
    ) {
      setExtractedContactName(
        data.supplierContactName || data.supplierContactEmail || undefined
      );
    } else {
      setExtractedContactName(undefined);
    }

    if (data.supplierContactEmail && !resolvedContactId) {
      setExtractedContactEmail(data.supplierContactEmail);
    } else {
      setExtractedContactEmail(undefined);
    }

    if (data.supplierContactPhone && !resolvedContactId) {
      setExtractedContactPhone(data.supplierContactPhone);
    } else {
      setExtractedContactPhone(undefined);
    }

    if (
      (data.supplierAddressLine1 || data.supplierCity) &&
      !resolvedLocationId
    ) {
      setExtractedAddress({
        addressLine1: data.supplierAddressLine1,
        addressLine2: data.supplierAddressLine2,
        city: data.supplierCity,
        stateProvince: data.supplierStateProvince,
        postalCode: data.supplierPostalCode,
        countryCode: data.supplierCountry
      });
    } else {
      setExtractedAddress(undefined);
    }

    let finalContactId = resolvedContactId;
    let finalLocationId = resolvedLocationId;

    if (
      carbon &&
      resolvedSupplierId &&
      resolvedSupplierId !== invoiceSupplier.id
    ) {
      flushSync(() => {
        setSupplier({ id: resolvedSupplierId });
        setInvoiceSupplier({
          id: resolvedSupplierId,
          currencyCode: resolvedCurrencyCode ?? undefined,
          paymentTermId: resolvedPaymentTermId ?? undefined,
          invoiceSupplierContactId: resolvedContactId,
          invoiceSupplierLocationId: resolvedLocationId
        });
      });

      const [supplierDetails, paymentTermData] = await Promise.all([
        carbon
          .from("supplier")
          .select(
            "currencyCode, purchasingContactId, supplierShipping!supplierId(shippingSupplierLocationId)"
          )
          .eq("id", resolvedSupplierId)
          .single(),
        carbon
          .from("supplierPayment")
          .select("*")
          .eq("supplierId", resolvedSupplierId)
          .single()
      ]);

      if (
        supplierDetails &&
        !supplierDetails.error &&
        paymentTermData &&
        !paymentTermData.error
      ) {
        finalContactId =
          resolvedContactId ??
          paymentTermData.data.invoiceSupplierContactId ??
          supplierDetails.data.purchasingContactId ??
          undefined;
        finalLocationId =
          resolvedLocationId ??
          paymentTermData.data.invoiceSupplierLocationId ??
          supplierDetails.data.supplierShipping?.shippingSupplierLocationId ??
          undefined;

        setInvoiceSupplier((prev) => ({
          ...prev,
          invoiceSupplierContactId: finalContactId,
          invoiceSupplierLocationId: finalLocationId,
          currencyCode:
            resolvedCurrencyCode ??
            supplierDetails.data.currencyCode ??
            undefined,
          paymentTermId:
            resolvedPaymentTermId ??
            paymentTermData.data.paymentTermId ??
            undefined
        }));
      }
    } else {
      finalContactId =
        resolvedContactId ?? invoiceSupplier.invoiceSupplierContactId;
      finalLocationId =
        resolvedLocationId ?? invoiceSupplier.invoiceSupplierLocationId;

      setInvoiceSupplier((prev) => ({
        ...prev,
        currencyCode: resolvedCurrencyCode ?? prev.currencyCode,
        paymentTermId: resolvedPaymentTermId ?? prev.paymentTermId,
        invoiceSupplierContactId: finalContactId,
        invoiceSupplierLocationId: finalLocationId
      }));
    }

    setCurrentValues((prev) => ({
      ...prev,
      supplierId: resolvedSupplierId || prev.supplierId,
      invoiceSupplierId: resolvedSupplierId || prev.invoiceSupplierId,
      supplierReference: data.invoiceNumber || prev.supplierReference,
      dateIssued: data.invoiceDate || prev.dateIssued,
      dateDue: data.dueDate || prev.dateDue,
      currencyCode: resolvedCurrencyCode || prev.currencyCode,
      paymentTermId: resolvedPaymentTermId || prev.paymentTermId,
      supplierShippingCost: data.shippingCost || prev.supplierShippingCost,
      invoiceSupplierContactId: finalContactId || prev.invoiceSupplierContactId,
      invoiceSupplierLocationId:
        finalLocationId || prev.invoiceSupplierLocationId
    }));

    if (data.supplierName && !foundSupplierInDb) {
      setExtractedSupplierName(data.supplierName);
      toast.info(
        t`Extracted supplier "${data.supplierName}" was not found. Please create it or select an existing one.`
      );
    } else {
      setExtractedSupplierName(undefined);
    }

    if (data.lineItems && Array.isArray(data.lineItems)) {
      setExtractedLineItems(data.lineItems);
    }

    if (data.taxAmount) {
      setExtractedTaxAmount(data.taxAmount);
    }

    if (data._storagePath) {
      setExtractedStoragePath(data._storagePath);
    }

    setFormKey((prev) => prev + 1);
  };

  const onSupplierChange = async (
    newValue: { value: string | undefined } | null
  ) => {
    setSupplier({ id: newValue?.value });
    if (newValue?.value !== invoiceSupplier.id) {
      onInvoiceSupplierChange(newValue);
    }
  };

  const onInvoiceSupplierChange = async (
    newValue: { value: string | undefined } | null
  ) => {
    if (!carbon) {
      toast.error(t`Carbon client not found`);
      return;
    }

    if (newValue?.value) {
      flushSync(() => {
        // update the supplier immediately
        setInvoiceSupplier({
          id: newValue?.value,
          currencyCode: undefined,
          paymentTermId: undefined,
          invoiceSupplierContactId: undefined,
          invoiceSupplierLocationId: undefined
        });
      });

      const [supplierData, paymentTermData] = await Promise.all([
        carbon
          .from("supplier")
          .select(
            "name, currencyCode, purchasingContactId, supplierShipping!supplierId(shippingSupplierLocationId)"
          )
          .eq("id", newValue.value)
          .single(),
        carbon
          .from("supplierPayment")
          .select("*")
          .eq("supplierId", newValue.value)
          .single()
      ]);

      if (supplierData.error || paymentTermData.error) {
        toast.error(t`Error fetching supplier data`);
      } else {
        if (supplierData.data.name !== extractedSupplierName) {
          setExtractedContactName(undefined);
          setExtractedContactEmail(undefined);
          setExtractedContactPhone(undefined);
          setExtractedAddress(undefined);
        }

        setInvoiceSupplier((prev) => ({
          ...prev,
          id: newValue.value,
          invoiceSupplierContactId:
            paymentTermData.data.invoiceSupplierContactId ??
            supplierData.data.purchasingContactId ??
            undefined,
          invoiceSupplierLocationId:
            paymentTermData.data.invoiceSupplierLocationId ??
            supplierData.data.supplierShipping?.shippingSupplierLocationId ??
            undefined,
          currencyCode: supplierData.data.currencyCode ?? undefined,
          paymentTermId: paymentTermData.data.paymentTermId ?? undefined
        }));
      }
    } else {
      setInvoiceSupplier({
        id: undefined,
        currencyCode: undefined,
        paymentTermId: undefined,
        invoiceSupplierContactId: undefined,
        invoiceSupplierLocationId: undefined
      });
    }
  };

  return {
    supplier,
    invoiceSupplier,
    setInvoiceSupplier,
    currentValues,
    formKey,
    extractedSupplierName,
    extractedContactName,
    extractedContactEmail,
    extractedContactPhone,
    extractedAddress,
    extractedLineItems,
    extractedTaxAmount,
    extractedStoragePath,
    handleExtractionComplete,
    onSupplierChange,
    onInvoiceSupplierChange
  };
}
