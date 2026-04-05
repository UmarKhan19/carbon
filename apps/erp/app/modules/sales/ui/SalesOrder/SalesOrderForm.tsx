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
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Currency,
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
import ExchangeRate from "~/components/Form/ExchangeRate";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { isSalesOrderLocked, salesOrderValidator } from "../../sales.models";

type SalesOrderFormValues = z.infer<typeof salesOrderValidator>;

type SalesOrderFormProps = {
  initialValues: SalesOrderFormValues & {
    originatedFromQuote: boolean;
    digitalQuoteAcceptedBy: string | undefined;
    digitalQuoteAcceptedByEmail: string | undefined;
  };
};

const SalesOrderForm = ({ initialValues }: SalesOrderFormProps) => {
  const { _: t } = useLingui();
  const { _: tShared } = useLingui();
  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [customer, setCustomer] = useState<{
    id: string | undefined;
    currencyCode: string | undefined;
    customerContactId: string | undefined;
    customerLocationId: string | undefined;
  }>({
    id: initialValues.customerId,
    currencyCode: initialValues.currencyCode,
    customerContactId: initialValues.customerContactId,
    customerLocationId: initialValues.customerLocationId
  });
  const isEditing = initialValues.id !== undefined;
  const isCustomer = permissions.is("customer");

  const orderId = initialValues.id;
  const routeData = useRouteData<{ salesOrder: { status: string } }>(
    orderId ? path.to.salesOrder(orderId) : ""
  );
  const isLocked = isSalesOrderLocked(routeData?.salesOrder?.status);

  const exchangeRateFetcher = useFetcher<{ exchangeRate: number }>();

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
        // update the customer immediately
        setCustomer({
          id: newValue?.value,
          currencyCode: undefined,
          customerContactId: undefined,
          customerLocationId: undefined
        });
      });

      const { data, error } = await carbon
        ?.from("customer")
        .select(
          "currencyCode, salesContactId, customerShipping!customerId(shippingCustomerLocationId)"
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
          currencyCode: data.currencyCode ?? undefined,
          customerContactId: data.salesContactId ?? undefined,
          customerLocationId:
            data.customerShipping?.shippingCustomerLocationId ?? undefined
        }));
      }
    } else {
      setCustomer({
        id: undefined,
        currencyCode: undefined,
        customerContactId: undefined,
        customerLocationId: undefined
      });
    }
  };

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={salesOrderValidator}
        defaultValues={initialValues}
        isDisabled={isEditing && isLocked}
      >
        <CardHeader>
          <CardTitle>
            {isEditing
              ? t(msg({ id: "Sales Order", message: "Sales Order" }))
              : t(msg({ id: "New Sales Order", message: "New Sales Order" }))}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              {t(
                msg({
                  id: "A sales order contains information about the agreement between the company and a specific customer for parts and services.",
                  message:
                    "A sales order contains information about the agreement between the company and a specific customer for parts and services."
                })
              )}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {isEditing && <Hidden name="salesOrderId" />}
          <Hidden name="status" />
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
                  name="salesOrderId"
                  label={t(
                    msg({ id: "Sales Order ID", message: "Sales Order ID" })
                  )}
                  table="salesOrder"
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
                label={t(
                  msg({
                    id: "Customer PO Number",
                    message: "Customer PO Number"
                  })
                )}
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

              {initialValues.originatedFromQuote &&
                initialValues.digitalQuoteAcceptedBy &&
                initialValues.digitalQuoteAcceptedByEmail && (
                  <>
                    <Input
                      name="digitalQuoteAcceptedBy"
                      label={t(
                        msg({
                          id: "Quote Accepted By",
                          message: "Quote Accepted By"
                        })
                      )}
                      isDisabled
                    />
                    <Input
                      name="digitalQuoteAcceptedByEmail"
                      label={t(
                        msg({
                          id: "Quote Accepted By Email",
                          message: "Quote Accepted By Email"
                        })
                      )}
                      isDisabled
                    />
                  </>
                )}

              <DatePicker
                name="requestedDate"
                label={t(
                  msg({ id: "Requested Date", message: "Requested Date" })
                )}
                helperText={t(
                  msg({
                    id: "The date the customer expects to receive the goods",
                    message:
                      "The date the customer expects to receive the goods"
                  })
                )}
                isDisabled={isCustomer}
              />

              <DatePicker
                name="promisedDate"
                label={t(
                  msg({ id: "Promised Date", message: "Promised Date" })
                )}
                helperText={t(
                  msg({
                    id: "The date the customer expects to receive the goods",
                    message:
                      "The date the customer expects to receive the goods"
                  })
                )}
                isDisabled={isCustomer}
              />

              <Location
                name="locationId"
                label={t(
                  msg({ id: "Sales Location", message: "Sales Location" })
                )}
              />

              <Employee
                name="salesPersonId"
                label={t(msg({ id: "Sales Person", message: "Sales Person" }))}
              />

              <Currency
                name="currencyCode"
                label={t(msg({ id: "Currency", message: "Currency" }))}
                value={customer.currencyCode}
                onChange={(newValue) => {
                  if (newValue?.value) {
                    setCustomer((prevCustomer) => ({
                      ...prevCustomer,
                      currencyCode: newValue.value
                    }));
                  }
                }}
                disabled={initialValues.originatedFromQuote}
              />

              {isEditing &&
                !!customer.currencyCode &&
                customer.currencyCode !== company.baseCurrencyCode && (
                  <ExchangeRate
                    name="exchangeRate"
                    value={initialValues.exchangeRate ?? 1}
                    exchangeRateUpdatedAt={initialValues.exchangeRateUpdatedAt}
                    isReadOnly
                    onRefresh={
                      !initialValues.originatedFromQuote
                        ? () => {
                            const formData = new FormData();
                            formData.append(
                              "currencyCode",
                              customer.currencyCode ?? ""
                            );
                            exchangeRateFetcher.submit(formData, {
                              method: "post",
                              action: path.to.salesOrderExchangeRate(
                                initialValues.id ?? ""
                              )
                            });
                          }
                        : undefined
                    }
                  />
                )}

              <CustomFormFields table="salesOrder" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isEditing
                ? !permissions.can("update", "sales")
                : !permissions.can("create", "sales")
            }
          >
            {tShared(msg({ id: "Save", message: "Save" }))}
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default SalesOrderForm;
