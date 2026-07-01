import { useCarbon } from "@carbon/auth";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { flushSync } from "react-dom";
import type { z } from "zod";
import type {
  ExtractedDocumentData,
  ExtractionContactRow,
  ExtractionLocationRow,
  SalesRfqExtraction,
  SalesRfqLineItem
} from "~/modules/documents";
import {
  findMatchingContactId,
  findMatchingLocationId,
  splitContactName
} from "~/modules/documents";
import type { salesRfqValidator } from "../../sales.models";

type SalesRFQFormValues = z.infer<typeof salesRfqValidator>;

type ExtractedContact = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
};

type ExtractedLocation = {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateProvince?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
};

type CustomerState = {
  id: string | undefined;
  customerContactId: string | undefined;
  customerEngineeringContactId: string | undefined;
  customerLocationId: string | undefined;
};

/**
 * Owns the PDF auto-fill orchestration for the Sales RFQ form: resolving the
 * extracted customer/contacts/location against existing records, stashing
 * unmatched values for create-on-the-fly, and re-keying the form with the
 * resolved defaults. Keeps this logic out of the presentational form.
 */
export function useSalesRfqAutoFill(initialValues: SalesRFQFormValues) {
  const { t } = useLingui();
  const { carbon } = useCarbon();

  const [customer, setCustomer] = useState<CustomerState>({
    id: initialValues.customerId,
    customerContactId: initialValues.customerContactId,
    customerEngineeringContactId: initialValues.customerEngineeringContactId,
    customerLocationId: initialValues.customerLocationId
  });

  const [extractedCustomerName, setExtractedCustomerName] = useState<string>();
  const [extractedLineItems, setExtractedLineItems] = useState<
    SalesRfqLineItem[]
  >([]);
  const [extractedLocation, setExtractedLocation] =
    useState<ExtractedLocation>();
  const [extractedPurchasingContact, setExtractedPurchasingContact] =
    useState<ExtractedContact>();
  const [extractedEngineeringContact, setExtractedEngineeringContact] =
    useState<ExtractedContact>();
  const [extractedStoragePath, setExtractedStoragePath] = useState<string>();

  const [formKey, setFormKey] = useState(0);
  const [currentValues, setCurrentValues] = useState(initialValues);

  const handleExtractionComplete = async (raw: ExtractedDocumentData) => {
    const data = raw as SalesRfqExtraction & { _storagePath?: string | null };

    let resolvedCustomerId = currentValues.customerId;
    let foundCustomerInDb = false;

    if (carbon && data.customerName) {
      const { data: customerData } = await carbon
        .from("customer")
        .select("id")
        .ilike("name", `%${data.customerName.trim()}%`)
        .limit(1);

      if (customerData && customerData.length > 0) {
        resolvedCustomerId = customerData[0].id;
        foundCustomerInDb = true;
      }
    }

    setCurrentValues((prev) => ({
      ...prev,
      customerId: resolvedCustomerId || prev.customerId,
      customerReference: data.rfqNumber || prev.customerReference,
      rfqDate: data.rfqDate || prev.rfqDate,
      expirationDate: data.dueDate || prev.expirationDate
    }));

    let resolvedPurchasingContactId: string | undefined = undefined;
    let resolvedEngineeringContactId: string | undefined = undefined;
    let resolvedLocationId: string | undefined = undefined;

    if (carbon && resolvedCustomerId) {
      const [contactResult, locationResult] = await Promise.all([
        carbon
          .from("customerContact")
          .select("id, contact(id, fullName, email)")
          .eq("customerId", resolvedCustomerId),
        carbon
          .from("customerLocation")
          .select("id, address(id, addressLine1)")
          .eq("customerId", resolvedCustomerId)
      ]);

      if (contactResult.data) {
        const contacts =
          contactResult.data as unknown as ExtractionContactRow[];
        resolvedPurchasingContactId = findMatchingContactId(contacts, {
          name: data.purchasingContactName,
          email: data.purchasingContactEmail
        });
        resolvedEngineeringContactId = findMatchingContactId(contacts, {
          name: data.engineeringContactName,
          email: data.engineeringContactEmail
        });
      }

      if (locationResult.data) {
        resolvedLocationId = findMatchingLocationId(
          locationResult.data as unknown as ExtractionLocationRow[],
          data.customerAddressLine1
        );
      }
    }

    if (data.customerName && !foundCustomerInDb) {
      setExtractedCustomerName(data.customerName);
      toast.info(
        t`Extracted customer "${data.customerName}" was not found. Please create it or select an existing one.`
      );
    } else {
      setExtractedCustomerName(undefined);
    }

    if (data.lineItems && Array.isArray(data.lineItems)) {
      setExtractedLineItems(data.lineItems);
    }

    if (
      (data.customerAddressLine1 || data.customerCity) &&
      !resolvedLocationId
    ) {
      setExtractedLocation({
        addressLine1: data.customerAddressLine1,
        addressLine2: data.customerAddressLine2,
        city: data.customerCity,
        stateProvince: data.customerStateProvince,
        postalCode: data.customerPostalCode,
        countryCode: data.customerCountry
      });
    } else {
      setExtractedLocation(undefined);
    }

    if (
      (data.purchasingContactName || data.purchasingContactEmail) &&
      !resolvedPurchasingContactId
    ) {
      setExtractedPurchasingContact({
        ...splitContactName(data.purchasingContactName),
        email: data.purchasingContactEmail,
        phone: data.purchasingContactPhone
      });
    } else {
      setExtractedPurchasingContact(undefined);
    }

    if (
      (data.engineeringContactName || data.engineeringContactEmail) &&
      !resolvedEngineeringContactId
    ) {
      setExtractedEngineeringContact({
        ...splitContactName(data.engineeringContactName),
        email: data.engineeringContactEmail,
        phone: data.engineeringContactPhone
      });
    } else {
      setExtractedEngineeringContact(undefined);
    }

    if (data._storagePath) {
      setExtractedStoragePath(data._storagePath);
    }

    let finalPurchasingContactId = resolvedPurchasingContactId;
    let finalLocationId = resolvedLocationId;

    if (carbon && resolvedCustomerId && resolvedCustomerId !== customer.id) {
      flushSync(() => {
        setCustomer({
          id: resolvedCustomerId,
          customerContactId: resolvedPurchasingContactId,
          customerEngineeringContactId: resolvedEngineeringContactId,
          customerLocationId: resolvedLocationId
        });
      });

      const { data: customerDetails, error } = await carbon
        .from("customer")
        .select(
          "salesContactId, customerShipping!customerId(shippingCustomerLocationId)"
        )
        .eq("id", resolvedCustomerId)
        .single();

      if (customerDetails && !error) {
        finalPurchasingContactId =
          resolvedPurchasingContactId ??
          customerDetails.salesContactId ??
          undefined;
        finalLocationId =
          resolvedLocationId ??
          customerDetails.customerShipping?.shippingCustomerLocationId ??
          undefined;

        setCustomer((prev) => ({
          ...prev,
          customerContactId: finalPurchasingContactId,
          customerLocationId: finalLocationId
        }));
      }
    } else {
      finalPurchasingContactId =
        resolvedPurchasingContactId ?? customer.customerContactId;
      finalLocationId = resolvedLocationId ?? customer.customerLocationId;

      setCustomer((prev) => ({
        ...prev,
        customerContactId: finalPurchasingContactId,
        customerEngineeringContactId:
          resolvedEngineeringContactId ?? prev.customerEngineeringContactId,
        customerLocationId: finalLocationId
      }));
    }

    setCurrentValues((prev) => ({
      ...prev,
      customerId: resolvedCustomerId || prev.customerId,
      customerReference: data.rfqNumber || prev.customerReference,
      rfqDate: data.rfqDate || prev.rfqDate,
      expirationDate: data.dueDate || prev.expirationDate,
      customerContactId: finalPurchasingContactId || prev.customerContactId,
      customerEngineeringContactId:
        resolvedEngineeringContactId || prev.customerEngineeringContactId,
      customerLocationId: finalLocationId || prev.customerLocationId
    }));

    setFormKey((prev) => prev + 1);
  };

  const onCustomerChange = async (
    newValue: { value: string | undefined } | null
  ) => {
    if (!carbon) {
      toast.error(t`Carbon client not found`);
      return;
    }

    if (newValue?.value) {
      flushSync(() => {
        setCustomer({
          id: newValue?.value,
          customerContactId: undefined,
          customerEngineeringContactId: undefined,
          customerLocationId: undefined
        });
      });

      const { data, error } = await carbon
        .from("customer")
        .select(
          "salesContactId, customerShipping!customerId(shippingCustomerLocationId)"
        )
        .eq("id", newValue.value)
        .single();
      if (error) {
        toast.error(t`Error fetching customer data`);
      } else {
        setCustomer((prev) => ({
          ...prev,
          customerContactId: data.salesContactId ?? undefined,
          customerLocationId:
            data.customerShipping?.shippingCustomerLocationId ?? undefined
        }));
      }
    } else {
      setCustomer({
        id: undefined,
        customerContactId: undefined,
        customerEngineeringContactId: undefined,
        customerLocationId: undefined
      });
    }
  };

  return {
    customer,
    currentValues,
    formKey,
    extractedCustomerName,
    extractedLineItems,
    extractedLocation,
    extractedPurchasingContact,
    extractedEngineeringContact,
    extractedStoragePath,
    handleExtractionComplete,
    onCustomerChange
  };
}
