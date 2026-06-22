import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  HStack,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { flushSync } from "react-dom";
import type { z } from "zod";
import {
  Customer,
  CustomerContact,
  CustomerLocation,
  CustomFormFields,
  DatePicker,
  Employee,
  Hidden,
  Input,
  Location,
  SequenceOrCustomId,
  Submit
} from "~/components/Form";
import { Autofill, type AutofillResult } from "~/components/Form/Autofill";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { isSalesRfqLocked, salesRfqValidator } from "../../sales.models";
import type { SalesRFQ } from "../../types";

type SalesRFQFormValues = z.infer<typeof salesRfqValidator>;

type SalesRFQFormProps = {
  initialValues: SalesRFQFormValues;
};

const SalesRFQForm = ({ initialValues }: SalesRFQFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const [customer, setCustomer] = useState<{
    id: string | undefined;
    customerContactId: string | undefined;
    customerEngineeringContactId: string | undefined;
    customerLocationId: string | undefined;
  }>({
    id: initialValues.customerId,
    customerContactId: initialValues.customerContactId,
    customerEngineeringContactId: initialValues.customerEngineeringContactId,
    customerLocationId: initialValues.customerLocationId
  });
  const isEditing = initialValues.id !== undefined;
  const isCustomer = permissions.is("customer");

  const routeData = useRouteData<{
    rfqSummary: SalesRFQ;
  }>(initialValues.id ? path.to.salesRfq(initialValues.id) : "");

  const isLocked = isSalesRfqLocked(routeData?.rfqSummary?.status);
  const [extractedLineItems, setExtractedLineItems] = useState<unknown[]>([]);
  const [extractedStoragePath, setExtractedStoragePath] = useState<string>();
  const isDraft = ["Draft", "Ready to Quote"].includes(
    initialValues.status ?? ""
  );

  const [formKey, setFormKey] = useState(0);
  const [currentValues, setCurrentValues] = useState(initialValues);

  // Apply the modal's fully-resolved autofill result — a straight merge; the
  // Autofill modal already matched/created every entity.
  const applyAutofill = (result: AutofillResult) => {
    const v = result.values;
    const customerId =
      (v.customerId as string | undefined) ?? currentValues.customerId;

    setCustomer((prev) => ({
      ...prev,
      id: customerId ?? prev.id,
      customerContactId:
        (v.customerContactId as string | undefined) ?? prev.customerContactId,
      customerEngineeringContactId:
        (v.customerEngineeringContactId as string | undefined) ??
        prev.customerEngineeringContactId,
      customerLocationId:
        (v.customerLocationId as string | undefined) ?? prev.customerLocationId
    }));

    setCurrentValues((prev) => {
      const next = { ...prev };
      for (const [key, value] of Object.entries(v)) {
        if (value !== undefined && value !== null && value !== "") {
          (next as Record<string, unknown>)[key] = value;
        }
      }
      return next;
    });

    setExtractedLineItems(result.lineItems ?? []);
    if (result.storagePath) setExtractedStoragePath(result.storagePath);
    setFormKey((prev) => prev + 1);
  };

  const onCustomerChange = async (
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
        setCustomer({
          id: newValue?.value,
          customerContactId: undefined,
          customerEngineeringContactId: undefined,
          customerLocationId: undefined
        });
      });

      const { data, error } = await carbon
        ?.from("customer")
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

  return (
    <Card>
      <ValidatedForm
        key={formKey}
        method="post"
        validator={salesRfqValidator}
        defaultValues={currentValues}
        isDisabled={isEditing && isLocked}
      >
        <HStack className="w-full justify-between items-start">
          <CardHeader>
            <CardTitle>
              {isEditing ? <Trans>RFQ</Trans> : <Trans>New RFQ</Trans>}
            </CardTitle>
            {!isEditing && (
              <CardDescription>
                <Trans>
                  A sales request for quote (RFQ) is a customer inquiry for
                  pricing on a set of parts and quantities. It may result in a
                  quote.
                </Trans>
              </CardDescription>
            )}
          </CardHeader>
          {!isEditing && (
            <CardAction>
              <Autofill
                documentType="salesRfq"
                sourceDocument="Request for Quote"
                sourceDocumentId={initialValues.id}
                onApply={applyAutofill}
              />
            </CardAction>
          )}
        </HStack>
        <CardContent>
          {isEditing && <Hidden name="rfqId" />}
          <input
            type="hidden"
            name="extractedLineItems"
            value={JSON.stringify(extractedLineItems)}
          />
          {extractedStoragePath && (
            <input
              type="hidden"
              name="extractedStoragePath"
              value={extractedStoragePath}
            />
          )}
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
                  name="rfqId"
                  label={t`RFQ ID`}
                  placeholder={t`Next Sequence`}
                  table="salesRfq"
                />
              )}
              <Customer
                autoFocus={!isEditing}
                name="customerId"
                label={t`Customer`}
                onChange={onCustomerChange}
              />
              <Input name="customerReference" label={t`Customer RFQ`} />
              <CustomerContact
                name="customerContactId"
                label={t`Purchasing Contact`}
                customer={customer.id}
                value={customer.customerContactId}
              />
              <CustomerContact
                name="customerEngineeringContactId"
                label={t`Engineering Contact`}
                customer={customer.id}
                value={customer.customerEngineeringContactId}
              />
              <CustomerLocation
                name="customerLocationId"
                label={t`Customer Location`}
                customer={customer.id}
                value={customer.customerLocationId}
              />
              <DatePicker
                name="rfqDate"
                label={t`RFQ Date`}
                isDisabled={isCustomer}
              />
              <DatePicker
                name="expirationDate"
                label={t`Due Date`}
                isDisabled={isCustomer}
              />
              <Location name="locationId" label={t`RFQ Location`} />
              <Employee name="salesPersonId" label={t`Sales Person`} />
              <CustomFormFields table="salesRfq" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              !isDraft ||
              (isEditing
                ? !permissions.can("update", "sales")
                : !permissions.can("create", "sales"))
            }
          >
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default SalesRFQForm;
