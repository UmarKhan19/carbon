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
  const [extractedCustomerName, setExtractedCustomerName] = useState<
    string | undefined
  >();
  const [extractedLineItems, setExtractedLineItems] = useState<any[]>([]);
  const [extractedLocation, setExtractedLocation] = useState<{
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    stateProvince?: string | null;
    postalCode?: string | null;
    countryCode?: string | null;
  }>();
  const [extractedPurchasingContact, setExtractedPurchasingContact] = useState<{
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  }>();
  const [extractedEngineeringContact, setExtractedEngineeringContact] =
    useState<{
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
      phone?: string | null;
    }>();
  const [extractedStoragePath, setExtractedStoragePath] = useState<string>();
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
        const pNameLower = data.purchasingContactName?.trim().toLowerCase();
        const pEmailLower = data.purchasingContactEmail?.trim().toLowerCase();
        if (pNameLower || pEmailLower) {
          const matched = contactResult.data.find((c: any) => {
            const dbEmail = c.contact?.email?.trim().toLowerCase();
            const dbName = c.contact?.fullName?.trim().toLowerCase();
            if (pEmailLower && dbEmail === pEmailLower) return true;
            if (pNameLower && dbName === pNameLower) return true;
            return false;
          });
          if (matched) resolvedPurchasingContactId = matched.id;
        }

        const eNameLower = data.engineeringContactName?.trim().toLowerCase();
        const eEmailLower = data.engineeringContactEmail?.trim().toLowerCase();
        if (eNameLower || eEmailLower) {
          const matched = contactResult.data.find((c: any) => {
            const dbEmail = c.contact?.email?.trim().toLowerCase();
            const dbName = c.contact?.fullName?.trim().toLowerCase();
            if (eEmailLower && dbEmail === eEmailLower) return true;
            if (eNameLower && dbName === eNameLower) return true;
            return false;
          });
          if (matched) resolvedEngineeringContactId = matched.id;
        }
      }

      if (locationResult.data) {
        const addressLower = data.customerAddressLine1?.trim().toLowerCase();
        if (addressLower) {
          const matched = locationResult.data.find((l: any) => {
            const dbAddress = l.address?.addressLine1?.trim().toLowerCase();
            if (!dbAddress) return false;
            return (
              addressLower.includes(dbAddress) ||
              dbAddress.includes(addressLower)
            );
          });
          if (matched) resolvedLocationId = matched.id;
        }
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
      const parts = (data.purchasingContactName || "").split(" ");
      const firstName = parts[0];
      const lastName = parts.slice(1).join(" ");
      setExtractedPurchasingContact({
        firstName,
        lastName,
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
      const parts = (data.engineeringContactName || "").split(" ");
      const firstName = parts[0];
      const lastName = parts.slice(1).join(" ");
      setExtractedEngineeringContact({
        firstName,
        lastName,
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

    if (resolvedCustomerId && resolvedCustomerId !== customer.id) {
      flushSync(() => {
        setCustomer({
          id: resolvedCustomerId,
          customerContactId: resolvedPurchasingContactId,
          customerEngineeringContactId: resolvedEngineeringContactId,
          customerLocationId: resolvedLocationId
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

    setCurrentValues((prev: any) => ({
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
                extractedValue={extractedCustomerName}
                onChange={onCustomerChange}
              />
              <Input
                name="customerReference"
                label={t`Customer RFQ`}
                termId="customer-document-reference"
              />
              <CustomerContact
                name="customerContactId"
                label={t`Purchasing Contact`}
                customer={customer.id}
                value={customer.customerContactId}
                extractedContact={extractedPurchasingContact}
              />
              <CustomerContact
                name="customerEngineeringContactId"
                label={t`Engineering Contact`}
                customer={customer.id}
                value={customer.customerEngineeringContactId}
                extractedContact={extractedEngineeringContact}
              />
              <CustomerLocation
                name="customerLocationId"
                label={t`Customer Location`}
                customer={customer.id}
                value={customer.customerLocationId}
                extractedLocation={extractedLocation}
              />
              <DatePicker
                name="rfqDate"
                label={t`RFQ Date`}
                helperText={t`The date you received this RFQ from the customer. Defaults to today.`}
                isDisabled={isCustomer}
                termId="rfq-date"
              />
              <DatePicker
                name="expirationDate"
                label={t`Due Date`}
                helperText={t`The deadline to send your quote to the customer.`}
                isDisabled={isCustomer}
                termId="sales-rfq-expiration-date"
              />
              <Location
                name="locationId"
                label={t`RFQ Location`}
                termId="rfq-receiving-location"
              />
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
