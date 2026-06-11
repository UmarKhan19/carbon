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
import { PdfExtractor } from "~/components/Form/PdfExtractor";
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
    customerLocationId: string | undefined;
  }>({
    id: initialValues.customerId,
    customerContactId: initialValues.customerContactId,
    customerLocationId: initialValues.customerLocationId
  });
  const isEditing = initialValues.id !== undefined;
  const isCustomer = permissions.is("customer");

  const routeData = useRouteData<{
    rfqSummary: SalesRFQ;
  }>(initialValues.id ? path.to.salesRfq(initialValues.id) : "");

  const isLocked = isSalesRfqLocked(routeData?.rfqSummary?.status);
  const [extractedCustomerName, setExtractedCustomerName] = useState<
    string | undefined
  >();
  const [extractedLineItems, setExtractedLineItems] = useState<any[]>([]);
  const isDraft = ["Draft", "Ready to Quote"].includes(
    initialValues.status ?? ""
  );

  const [formKey, setFormKey] = useState(0);
  const [currentValues, setCurrentValues] = useState(initialValues);

  const handleExtractionComplete = async (data: Record<string, any>) => {
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

    if (resolvedCustomerId && resolvedCustomerId !== customer.id) {
      flushSync(() => {
        setCustomer({
          id: resolvedCustomerId,
          customerContactId: undefined,
          customerLocationId: undefined
        });
      });

      const { data: customerDetails, error } = await carbon
        ?.from("customer")
        .select(
          "salesContactId, customerShipping!customerId(shippingCustomerLocationId)"
        )
        .eq("id", resolvedCustomerId)
        .single();

      if (customerDetails && !error) {
        setCustomer((prev) => ({
          ...prev,
          customerContactId: customerDetails.salesContactId ?? undefined,
          customerLocationId:
            customerDetails.customerShipping?.shippingCustomerLocationId ??
            undefined
        }));
      }
    }

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
        <CardContent>
          <PdfExtractor
            documentType="salesRfq"
            sourceDocument="Request for Quote"
            sourceDocumentId={initialValues.id}
            onExtractionComplete={handleExtractionComplete}
          />
          {isEditing && <Hidden name="rfqId" />}
          <input
            type="hidden"
            name="extractedLineItems"
            value={JSON.stringify(extractedLineItems)}
          />
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
                extractedValue={extractedCustomerName}
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
