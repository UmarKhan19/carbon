import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { flushSync } from "react-dom";
import { useParams } from "react-router";
import type { z } from "zod";
import {
  Currency,
  CustomFormFields,
  DatePicker,
  Hidden,
  Input,
  Location,
  SequenceOrCustomId,
  Submit,
  Supplier,
  SupplierContact,
  SupplierLocation
} from "~/components/Form";
import PaymentTerm from "~/components/Form/PaymentTerm";
import { PdfExtractor } from "~/components/Form/PdfExtractor";
import {
  usePermissions,
  useRouteData,
  useSupplierApprovalRequired
} from "~/hooks";
import { purchaseInvoiceValidator } from "~/modules/invoicing";
import { path } from "~/utils/path";
import { isPurchaseInvoiceLocked } from "../../invoicing.models";

type PurchaseInvoiceFormValues = z.infer<typeof purchaseInvoiceValidator>;

type PurchaseInvoiceFormProps = {
  initialValues: PurchaseInvoiceFormValues;
};

const PurchaseInvoiceForm = ({ initialValues }: PurchaseInvoiceFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const supplierApprovalRequired = useSupplierApprovalRequired();
  const { carbon } = useCarbon();
  const isEditing = initialValues.id !== undefined;

  const { invoiceId } = useParams();
  const routeData = useRouteData<{ purchaseInvoice: { status: string } }>(
    invoiceId ? path.to.purchaseInvoice(invoiceId) : ""
  );
  const isLocked = isPurchaseInvoiceLocked(routeData?.purchaseInvoice?.status);
  const [extractedSupplierName, setExtractedSupplierName] = useState<
    string | undefined
  >();
  const [extractedContactName, setExtractedContactName] = useState<string>();
  const [extractedContactEmail, setExtractedContactEmail] = useState<string>();
  const [extractedContactPhone, setExtractedContactPhone] = useState<string>();
  const [extractedAddress, setExtractedAddress] = useState<{
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    stateProvince?: string | null;
    postalCode?: string | null;
    countryCode?: string | null;
  }>();
  const [extractedLineItems, setExtractedLineItems] = useState<any[]>([]);
  const [extractedTaxAmount, setExtractedTaxAmount] = useState<number>(0);
  const [extractedStoragePath, setExtractedStoragePath] = useState<string>();

  const [formKey, setFormKey] = useState(0);
  const [currentValues, setCurrentValues] = useState(initialValues);

  const handleExtractionComplete = async (data: Record<string, any>) => {
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
        const [contactResult, locationResult] = await Promise.all([
          carbon
            .from("supplierContact")
            .select("id, contact(id, fullName, email)")
            .eq("supplierId", resolvedSupplierId),
          carbon
            .from("supplierLocation")
            .select("id, address(id, addressLine1)")
            .eq("supplierId", resolvedSupplierId)
        ]);

        if (contactResult.data) {
          const contactNameLower = data.supplierContactName
            ?.trim()
            .toLowerCase();
          const contactEmailLower = data.supplierContactEmail
            ?.trim()
            .toLowerCase();

          const matchedContact = contactResult.data.find((c: any) => {
            const dbEmail = c.contact?.email?.trim().toLowerCase();
            const dbName = c.contact?.fullName?.trim().toLowerCase();
            if (contactEmailLower && dbEmail === contactEmailLower) return true;
            if (contactNameLower && dbName === contactNameLower) return true;
            return false;
          });

          if (matchedContact) {
            resolvedContactId = matchedContact.id;
          }
        }

        if (locationResult.data) {
          const addressLower = data.supplierAddressLine1?.trim().toLowerCase();
          if (addressLower) {
            const matchedLocation = locationResult.data.find((l: any) => {
              const dbAddress = l.address?.addressLine1?.trim().toLowerCase();
              if (!dbAddress) return false;
              return (
                addressLower.includes(dbAddress) ||
                dbAddress.includes(addressLower)
              );
            });

            if (matchedLocation) {
              resolvedLocationId = matchedLocation.id;
            }
          }
        }
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
        data.supplierContactName || data.supplierContactEmail
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

    if (resolvedSupplierId && resolvedSupplierId !== invoiceSupplier.id) {
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
          ?.from("supplier")
          .select(
            "currencyCode, purchasingContactId, supplierShipping!supplierId(shippingSupplierLocationId)"
          )
          .eq("id", resolvedSupplierId)
          .single(),
        carbon
          ?.from("supplierPayment")
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

  const [invoiceSupplier, setInvoiceSupplier] = useState<{
    id: string | undefined;
    invoiceSupplierContactId: string | undefined;
    invoiceSupplierLocationId: string | undefined;
    currencyCode: string | undefined;
    paymentTermId: string | undefined;
  }>({
    id: initialValues.invoiceSupplierId,
    invoiceSupplierContactId: initialValues.invoiceSupplierContactId,
    invoiceSupplierLocationId: initialValues.invoiceSupplierLocationId,
    currencyCode: initialValues.currencyCode,
    paymentTermId: initialValues.paymentTermId
  });

  const [supplier, setSupplier] = useState<{
    id: string | undefined;
  }>({
    id: initialValues.supplierId
  });

  const onSupplierChange = async (
    newValue: {
      value: string | undefined;
    } | null
  ) => {
    setSupplier({ id: newValue?.value });
    if (newValue?.value !== invoiceSupplier.id) {
      onInvoiceSupplierChange(newValue);
    }
  };

  const onInvoiceSupplierChange = async (
    newValue: {
      value: string | undefined;
    } | null
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
          ?.from("supplier")
          .select(
            "name, currencyCode, purchasingContactId, supplierShipping!supplierId(shippingSupplierLocationId)"
          )
          .eq("id", newValue.value)
          .single(),
        carbon
          ?.from("supplierPayment")
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

  return (
    <ValidatedForm
      key={formKey}
      method="post"
      validator={purchaseInvoiceValidator}
      defaultValues={currentValues}
      isDisabled={isEditing && isLocked}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            {isEditing ? "Purchase Invoice" : "New Purchase Invoice"}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              <Trans>
                A purchase invoice is a document that specifies the products or
                services purchased by a customer and the corresponding cost.
              </Trans>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <PdfExtractor
            documentType="purchaseInvoice"
            sourceDocument="Purchase Invoice"
            sourceDocumentId={initialValues.id}
            onExtractionComplete={handleExtractionComplete}
          />
          <Hidden name="id" />
          <input
            type="hidden"
            name="extractedLineItems"
            value={JSON.stringify(extractedLineItems)}
          />
          <input
            type="hidden"
            name="extractedTaxAmount"
            value={extractedTaxAmount}
          />
          {extractedStoragePath && (
            <input
              type="hidden"
              name="extractedStoragePath"
              value={extractedStoragePath}
            />
          )}
          {currentValues.supplierShippingCost !== undefined && (
            <input
              type="hidden"
              name="supplierShippingCost"
              value={currentValues.supplierShippingCost}
            />
          )}
          {isEditing && <Hidden name="invoiceId" />}
          <VStack>
            <div
              className={cn(
                "grid w-full gap-x-8 gap-y-4",
                isEditing
                  ? "grid-cols-1 lg:grid-cols-3"
                  : "grid-cols-1 md:grid-cols-2"
              )}
            >
              {!isEditing && (
                <SequenceOrCustomId
                  name="invoiceId"
                  label={t`Invoice ID`}
                  table="purchaseInvoice"
                />
              )}
              <Supplier
                name="supplierId"
                label={t`Supplier`}
                extractedValue={extractedSupplierName}
                defaultCurrencyCode={invoiceSupplier.currencyCode}
                onChange={onSupplierChange}
                onlyApproved={supplierApprovalRequired}
              />
              <Input
                name="supplierReference"
                label={t`Supplier Invoice Number`}
              />

              <Supplier
                name="invoiceSupplierId"
                label={t`Invoice Supplier`}
                extractedValue={extractedSupplierName}
                value={invoiceSupplier.id}
                defaultCurrencyCode={invoiceSupplier.currencyCode}
                onChange={onInvoiceSupplierChange}
                onlyApproved={supplierApprovalRequired}
              />
              <SupplierLocation
                name="invoiceSupplierLocationId"
                label={t`Invoice Supplier Location`}
                supplier={supplier.id}
                value={invoiceSupplier.invoiceSupplierLocationId}
                extractedAddress={extractedAddress}
                onChange={(newValue) => {
                  if (newValue?.id) {
                    setInvoiceSupplier((prevSupplier) => ({
                      ...prevSupplier,
                      invoiceSupplierLocationId: newValue.id
                    }));
                  }
                }}
              />
              <SupplierContact
                name="invoiceSupplierContactId"
                label={t`Invoice Supplier Contact`}
                supplier={supplier.id}
                value={invoiceSupplier.invoiceSupplierContactId}
                extractedValue={extractedContactName}
                extractedEmail={extractedContactEmail}
                extractedPhone={extractedContactPhone}
                onChange={(newValue) => {
                  if (newValue?.id) {
                    setInvoiceSupplier((prevSupplier) => ({
                      ...prevSupplier,
                      invoiceSupplierContactId: newValue.id
                    }));
                  }
                }}
              />

              <DatePicker name="dateDue" label={t`Due Date`} />
              <DatePicker name="dateIssued" label={t`Date Issued`} />

              <PaymentTerm
                name="paymentTermId"
                label={t`Payment Terms`}
                value={invoiceSupplier?.paymentTermId}
                onChange={(newValue) => {
                  if (newValue?.value) {
                    setInvoiceSupplier((prevSupplier) => ({
                      ...prevSupplier,
                      paymentTermId: newValue.value
                    }));
                  }
                }}
              />
              <Currency
                name="currencyCode"
                label={t`Currency`}
                value={invoiceSupplier?.currencyCode}
                onChange={(newValue) => {
                  if (newValue?.value) {
                    setInvoiceSupplier((prevSupplier) => ({
                      ...prevSupplier,
                      currencyCode: newValue.value
                    }));
                  }
                }}
              />
              <Location name="locationId" label={t`Delivery Location`} />
              <CustomFormFields table="purchaseInvoice" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isEditing
                ? !permissions.can("update", "invoicing")
                : !permissions.can("create", "invoicing")
            }
          >
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default PurchaseInvoiceForm;
