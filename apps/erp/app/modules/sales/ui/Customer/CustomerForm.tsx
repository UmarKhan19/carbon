import { ValidatedForm } from "@carbon/form";
import {
  cn,
  HStack,
  ModalCard,
  ModalCardBody,
  ModalCardContent,
  ModalCardDescription,
  ModalCardFooter,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  toast
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Currency,
  CustomerContact,
  CustomerStatus,
  CustomerType,
  CustomFormFields,
  Employee,
  Hidden,
  Input,
  Number,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { customerValidator } from "../../sales.models";
import type { Customer } from "../../types";

type CustomerFormProps = {
  initialValues: z.infer<typeof customerValidator>;
  type?: "card" | "modal";
  onClose?: () => void;
};

const CustomerForm = ({
  initialValues,
  type = "card",
  onClose
}: CustomerFormProps) => {
  const { t } = useLingui();
  const { t: tShared } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<Customer>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      const createdCustomer = Array.isArray(fetcher.data.data)
        ? fetcher.data.data[0]
        : fetcher.data.data;
      toast.success(
        t({
          id: "Created customer: {{name}}",
          message: `Created customer: ${
            createdCustomer?.name ?? t({ id: "Customer", message: "Customer" })
          }`
        })
      );
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        t({
          id: "Failed to create customer: {{message}}",
          message: `Failed to create customer: ${fetcher.data.error.message}`
        })
      );
    }
  }, [fetcher.data, fetcher.state, onClose, t, type]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

  return (
    <div>
      <ModalCardProvider type={type}>
        <ModalCard onClose={onClose}>
          <ModalCardContent size="medium">
            <ValidatedForm
              method="post"
              action={isEditing ? undefined : path.to.newCustomer}
              validator={customerValidator}
              defaultValues={initialValues}
              fetcher={fetcher}
            >
              <ModalCardHeader>
                <ModalCardTitle>
                  {isEditing
                    ? t({
                        id: "Customer Overview",
                        message: "Customer Overview"
                      })
                    : t({ id: "New Customer", message: "New Customer" })}
                </ModalCardTitle>
                {!isEditing && (
                  <ModalCardDescription>
                    {t({
                      id: "A customer is a business or person who buys your parts or services.",
                      message:
                        "A customer is a business or person who buys your parts or services."
                    })}
                  </ModalCardDescription>
                )}
              </ModalCardHeader>
              <ModalCardBody>
                <Hidden name="id" />
                <Hidden name="type" value={type} />
                <div
                  className={cn(
                    "grid w-full gap-x-8 gap-y-4",
                    type === "modal"
                      ? "grid-cols-1"
                      : isEditing
                        ? "grid-cols-1 lg:grid-cols-3"
                        : "grid-cols-1 md:grid-cols-2"
                  )}
                >
                  <Input
                    name="name"
                    label={t({ id: "Name", message: "Name" })}
                    autoFocus={!isEditing}
                  />

                  <CustomerStatus
                    name="customerStatusId"
                    label={t({
                      id: "Customer Status",
                      message: "Customer Status"
                    })}
                    placeholder={t({
                      id: "Select Customer Status",
                      message: "Select Customer Status"
                    })}
                  />
                  <CustomerType
                    name="customerTypeId"
                    label={t({ id: "Customer Type", message: "Customer Type" })}
                    placeholder={t({
                      id: "Select Customer Type",
                      message: "Select Customer Type"
                    })}
                  />
                  <Employee
                    name="accountManagerId"
                    label={t({
                      id: "Account Manager",
                      message: "Account Manager"
                    })}
                  />
                  {isEditing && (
                    <>
                      <CustomerContact
                        customer={initialValues.id}
                        name="salesContactId"
                        label={t({
                          id: "Sales Contact",
                          message: "Sales Contact"
                        })}
                      />
                    </>
                  )}
                  <Currency
                    name="currencyCode"
                    label={t({ id: "Currency", message: "Currency" })}
                  />

                  <Number
                    name="taxPercent"
                    label={t({ id: "Tax Percent", message: "Tax Percent" })}
                    minValue={0}
                    maxValue={1}
                    step={0.0001}
                    formatOptions={{
                      style: "percent",
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2
                    }}
                  />

                  <Input
                    name="taxId"
                    label={t({ id: "Tax ID", message: "Tax ID" })}
                  />
                  <Input
                    name="vatNumber"
                    label={t({ id: "VAT Number", message: "VAT Number" })}
                  />
                  <Input
                    name="website"
                    label={t({ id: "Website", message: "Website" })}
                  />

                  {/* <EmailRecipients name="defaultCc" label="Default CC" /> */}
                  <CustomFormFields table="customer" />
                </div>
              </ModalCardBody>
              <ModalCardFooter>
                <HStack>
                  <Submit isDisabled={isDisabled}>
                    {tShared({ id: "Save", message: "Save" })}
                  </Submit>
                </HStack>
              </ModalCardFooter>
            </ValidatedForm>
          </ModalCardContent>
        </ModalCard>
      </ModalCardProvider>
    </div>
  );
};

export default CustomerForm;
