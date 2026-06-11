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
  const [extractedLineItems, setExtractedLineItems] = useState<any[]>([]);

  const [formKey, setFormKey] = useState(0);
  const [currentValues, setCurrentValues] = useState(initialValues);

  const handleExtractionComplete = async (data: Record<string, any>) => {
    let resolvedSupplierId = currentValues.supplierId;
    let resolvedPaymentTermId = currentValues.paymentTermId;
    let resolvedCurrencyCode = currentValues.currencyCode;

    let foundSupplierInDb = false;

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
    }

    if (data.currencyCode) {
      resolvedCurrencyCode = data.currencyCode;
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
      supplierShippingCost: data.shippingCost || prev.supplierShippingCost
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

    if (resolvedSupplierId && resolvedSupplierId !== invoiceSupplier.id) {
      flushSync(() => {
        setSupplier({ id: resolvedSupplierId });
        setInvoiceSupplier({
          id: resolvedSupplierId,
          currencyCode: resolvedCurrencyCode ?? undefined,
          paymentTermId: resolvedPaymentTermId ?? undefined,
          invoiceSupplierContactId: undefined,
          invoiceSupplierLocationId: undefined
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
        setInvoiceSupplier((prev) => ({
          ...prev,
          invoiceSupplierContactId:
            paymentTermData.data.invoiceSupplierContactId ??
            supplierDetails.data.purchasingContactId ??
            undefined,
          invoiceSupplierLocationId:
            paymentTermData.data.invoiceSupplierLocationId ??
            supplierDetails.data.supplierShipping?.shippingSupplierLocationId ??
            undefined,
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
      setInvoiceSupplier((prev) => ({
        ...prev,
        currencyCode: resolvedCurrencyCode ?? prev.currencyCode,
        paymentTermId: resolvedPaymentTermId ?? prev.paymentTermId
      }));
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
            "currencyCode, purchasingContactId, supplierShipping!supplierId(shippingSupplierLocationId)"
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
                onChange={onInvoiceSupplierChange}
                onlyApproved={supplierApprovalRequired}
              />
              <SupplierLocation
                name="invoiceSupplierLocationId"
                label={t`Invoice Supplier Location`}
                supplier={supplier.id}
                value={invoiceSupplier.invoiceSupplierLocationId}
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
