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
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { isSalesRfqLocked, salesRfqValidator } from "../../sales.models";
import type { SalesRFQ } from "../../types";

type SalesRFQFormValues = z.infer<typeof salesRfqValidator>;

type SalesRFQFormProps = {
  initialValues: SalesRFQFormValues;
};

const SalesRFQForm = ({ initialValues }: SalesRFQFormProps) => {
  const { _: t } = useLingui();
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
  const isDraft = ["Draft", "Ready to Quote"].includes(
    initialValues.status ?? ""
  );

  const onCustomerChange = async (
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
        toast.error(
          t(
            msg({
              id: "Error fetching customer data",
              message: "Error fetching customer data"
            })
          )
        );
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
        method="post"
        validator={salesRfqValidator}
        defaultValues={initialValues}
        isDisabled={isEditing && isLocked}
      >
        <CardHeader>
          <CardTitle>
            {isEditing
              ? t(msg({ id: "RFQ", message: "RFQ" }))
              : t(msg({ id: "New RFQ", message: "New RFQ" }))}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              {t(
                msg({
                  id: "A sales request for quote (RFQ) is a customer inquiry for pricing on a set of parts and quantities. It may result in a quote.",
                  message:
                    "A sales request for quote (RFQ) is a customer inquiry for pricing on a set of parts and quantities. It may result in a quote."
                })
              )}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {isEditing && <Hidden name="rfqId" />}
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
                  label={t(msg({ id: "RFQ ID", message: "RFQ ID" }))}
                  placeholder={t(
                    msg({ id: "Next Sequence", message: "Next Sequence" })
                  )}
                  table="salesRfq"
                />
              )}
              <Customer
                autoFocus={!isEditing}
                name="customerId"
                label={t(msg({ id: "Customer", message: "Customer" }))}
                onChange={onCustomerChange}
              />
              <Input
                name="customerReference"
                label={t(msg({ id: "Customer RFQ", message: "Customer RFQ" }))}
              />
              <CustomerContact
                name="customerContactId"
                label={t(
                  msg({
                    id: "Purchasing Contact",
                    message: "Purchasing Contact"
                  })
                )}
                customer={customer.id}
                value={customer.customerContactId}
              />
              <CustomerContact
                name="customerEngineeringContactId"
                label={t(
                  msg({
                    id: "Engineering Contact",
                    message: "Engineering Contact"
                  })
                )}
                customer={customer.id}
              />
              <CustomerLocation
                name="customerLocationId"
                label={t(
                  msg({ id: "Customer Location", message: "Customer Location" })
                )}
                customer={customer.id}
                value={customer.customerLocationId}
              />
              <DatePicker
                name="rfqDate"
                label={t(msg({ id: "RFQ Date", message: "RFQ Date" }))}
                isDisabled={isCustomer}
              />
              <DatePicker
                name="expirationDate"
                label={t(msg({ id: "Due Date", message: "Due Date" }))}
                isDisabled={isCustomer}
              />
              <Location
                name="locationId"
                label={t(msg({ id: "RFQ Location", message: "RFQ Location" }))}
              />
              <Employee
                name="salesPersonId"
                label={t(msg({ id: "Sales Person", message: "Sales Person" }))}
              />
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
            {t(msg({ id: "Save", message: "Save" }))}
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default SalesRFQForm;
