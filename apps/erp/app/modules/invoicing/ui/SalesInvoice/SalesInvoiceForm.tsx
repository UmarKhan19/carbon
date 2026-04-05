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
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useState } from "react";
import { flushSync } from "react-dom";
import type { z } from "zod";
import {
  Currency,
  Customer,
  CustomerContact,
  CustomerLocation,
  CustomFormFields,
  DatePicker,
  Hidden,
  Input,
  Location,
  SequenceOrCustomId,
  Submit
} from "~/components/Form";
import PaymentTerm from "~/components/Form/PaymentTerm";
import { usePermissions, useRouteData } from "~/hooks";
import { salesInvoiceValidator } from "~/modules/invoicing";
import { path } from "~/utils/path";
import { isSalesInvoiceLocked } from "../../invoicing.models";

type SalesInvoiceFormValues = z.infer<typeof salesInvoiceValidator>;

type SalesInvoiceFormProps = {
  initialValues: SalesInvoiceFormValues;
};

const SalesInvoiceForm = ({ initialValues }: SalesInvoiceFormProps) => {
  const { _: t } = useLingui();
  const { _: tShared } = useLingui();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const isEditing = initialValues.id !== undefined;

  const invoiceId = initialValues.id;
  const routeData = useRouteData<{ salesInvoice: { status: string } }>(
    invoiceId ? path.to.salesInvoice(invoiceId) : ""
  );
  const isLocked = isSalesInvoiceLocked(routeData?.salesInvoice?.status);

  const [invoiceCustomer, setInvoiceCustomer] = useState<{
    id: string | undefined;
    invoiceCustomerContactId: string | undefined;
    invoiceCustomerLocationId: string | undefined;
    currencyCode: string | undefined;
    paymentTermId: string | undefined;
  }>({
    id: initialValues.invoiceCustomerId,
    invoiceCustomerContactId: initialValues.invoiceCustomerContactId,
    invoiceCustomerLocationId: initialValues.invoiceCustomerLocationId,
    currencyCode: initialValues.currencyCode,
    paymentTermId: initialValues.paymentTermId
  });

  const [customer, setCustomer] = useState<{
    id: string | undefined;
  }>({
    id: initialValues.customerId
  });

  const onCustomerChange = async (
    newValue: {
      value: string | undefined;
    } | null
  ) => {
    setCustomer({ id: newValue?.value });
    if (newValue?.value !== invoiceCustomer.id) {
      onInvoiceCustomerChange(newValue);
    }
  };

  const onInvoiceCustomerChange = async (
    newValue: {
      value: string | undefined;
    } | null
  ) => {
    if (!carbon) {
      toast.error(
        t(
          msg({
            id: "Carbon client not found",
            message: "Carbon client not found"
          })
        )
      );
      return;
    }

    if (newValue?.value) {
      flushSync(() => {
        // update the customer immediately
        setInvoiceCustomer({
          id: newValue?.value,
          currencyCode: undefined,
          paymentTermId: undefined,
          invoiceCustomerContactId: undefined,
          invoiceCustomerLocationId: undefined
        });
      });

      const [customerData, paymentTermData] = await Promise.all([
        carbon
          ?.from("customer")
          .select(
            "currencyCode, salesContactId, customerShipping!customerId(shippingCustomerLocationId)"
          )
          .eq("id", newValue.value)
          .single(),
        carbon
          ?.from("customerPayment")
          .select("*")
          .eq("customerId", newValue.value)
          .single()
      ]);

      if (customerData.error || paymentTermData.error) {
        toast.error(
          t(
            msg({
              id: "Error fetching customer data",
              message: "Error fetching customer data"
            })
          )
        );
      } else {
        setInvoiceCustomer((prev) => ({
          ...prev,
          id: newValue.value,
          invoiceCustomerContactId:
            paymentTermData.data.invoiceCustomerContactId ??
            customerData.data.salesContactId ??
            undefined,
          invoiceCustomerLocationId:
            paymentTermData.data.invoiceCustomerLocationId ??
            customerData.data.customerShipping?.shippingCustomerLocationId ??
            undefined,
          currencyCode: customerData.data.currencyCode ?? undefined,
          paymentTermId: paymentTermData.data.paymentTermId ?? undefined
        }));
      }
    } else {
      setInvoiceCustomer({
        id: undefined,
        currencyCode: undefined,
        paymentTermId: undefined,
        invoiceCustomerContactId: undefined,
        invoiceCustomerLocationId: undefined
      });
    }
  };

  return (
    <ValidatedForm
      method="post"
      validator={salesInvoiceValidator}
      defaultValues={initialValues}
      isDisabled={isEditing && isLocked}
    >
      <Card>
        <CardHeader>
          <CardTitle>
            {isEditing
              ? t(msg({ id: "Sales Invoice", message: "Sales Invoice" }))
              : t(
                  msg({ id: "New Sales Invoice", message: "New Sales Invoice" })
                )}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              {t(
                msg({
                  id: "A sales invoice is a document that specifies the products or services sold to a customer and the corresponding cost.",
                  message:
                    "A sales invoice is a document that specifies the products or services sold to a customer and the corresponding cost."
                })
              )}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
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
                  label={t(msg({ id: "Invoice ID", message: "Invoice ID" }))}
                  table="salesInvoice"
                />
              )}
              <Customer
                name="customerId"
                label={t(msg({ id: "Customer", message: "Customer" }))}
                onChange={onCustomerChange}
              />
              <Input
                name="customerReference"
                label={t(
                  msg({
                    id: "Customer Invoice Number",
                    message: "Customer Invoice Number"
                  })
                )}
              />

              <Customer
                name="invoiceCustomerId"
                label={t(
                  msg({ id: "Invoice Customer", message: "Invoice Customer" })
                )}
                value={invoiceCustomer.id}
                onChange={onInvoiceCustomerChange}
              />
              <CustomerLocation
                name="invoiceCustomerLocationId"
                label={t(
                  msg({
                    id: "Invoice Customer Location",
                    message: "Invoice Customer Location"
                  })
                )}
                customer={customer.id}
                value={invoiceCustomer.invoiceCustomerLocationId}
                onChange={(newValue) => {
                  if (newValue?.id) {
                    setInvoiceCustomer((prevCustomer) => ({
                      ...prevCustomer,
                      invoiceCustomerLocationId: newValue.id
                    }));
                  }
                }}
              />
              <CustomerContact
                name="invoiceCustomerContactId"
                label={t(
                  msg({
                    id: "Invoice Customer Contact",
                    message: "Invoice Customer Contact"
                  })
                )}
                customer={customer.id}
                value={invoiceCustomer.invoiceCustomerContactId}
                onChange={(newValue) => {
                  if (newValue?.id) {
                    setInvoiceCustomer((prevCustomer) => ({
                      ...prevCustomer,
                      invoiceCustomerContactId: newValue.id
                    }));
                  }
                }}
              />

              <DatePicker
                name="dateDue"
                label={t(msg({ id: "Due Date", message: "Due Date" }))}
              />
              <DatePicker
                name="dateIssued"
                label={t(msg({ id: "Date Issued", message: "Date Issued" }))}
              />

              <PaymentTerm
                name="paymentTermId"
                label={t(
                  msg({ id: "Payment Terms", message: "Payment Terms" })
                )}
                value={invoiceCustomer?.paymentTermId}
                onChange={(newValue) => {
                  if (newValue?.value) {
                    setInvoiceCustomer((prevCustomer) => ({
                      ...prevCustomer,
                      paymentTermId: newValue.value
                    }));
                  }
                }}
              />
              <Currency
                name="currencyCode"
                label={t(msg({ id: "Currency", message: "Currency" }))}
                value={invoiceCustomer?.currencyCode}
                onChange={(newValue) => {
                  if (newValue?.value) {
                    setInvoiceCustomer((prevCustomer) => ({
                      ...prevCustomer,
                      currencyCode: newValue.value
                    }));
                  }
                }}
              />
              <Location
                name="locationId"
                label={t(msg({ id: "Location", message: "Location" }))}
              />
              <CustomFormFields table="salesInvoice" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isEditing
                ? isLocked || !permissions.can("update", "invoicing")
                : !permissions.can("create", "invoicing")
            }
          >
            {tShared(msg({ id: "Save", message: "Save" }))}
          </Submit>
        </CardFooter>
      </Card>
    </ValidatedForm>
  );
};

export default SalesInvoiceForm;
