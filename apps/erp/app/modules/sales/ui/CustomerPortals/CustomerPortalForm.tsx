import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  toast,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { Customer, CustomFormFields, Hidden, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { customerPortalValidator } from "../../sales.models";

type CustomerPortalFormProps = {
  initialValues: z.infer<typeof customerPortalValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const CustomerPortalForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: CustomerPortalFormProps) => {
  const { _: t } = useLingui();
  const { _: tShared } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(
        t(
          msg({
            id: "Created customer portal",
            message: "Created customer portal"
          })
        )
      );
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        t(
          msg({
            id: "Failed to create customer portal: {{message}}",
            message: `Failed to create customer portal: ${fetcher.data.error.message}`
          })
        )
      );
    }
  }, [fetcher.data, fetcher.state, onClose, t, type]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={customerPortalValidator}
            method="post"
            action={
              isEditing
                ? path.to.customerPortal(initialValues.id!)
                : path.to.newCustomerPortal
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing
                  ? tShared(msg({ id: "Edit", message: "Edit" }))
                  : tShared(msg({ id: "New", message: "New" }))}{" "}
                {t(msg({ id: "Customer Portal", message: "Customer Portal" }))}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Customer
                  name="customerId"
                  label={t(msg({ id: "Customer", message: "Customer" }))}
                />
                <CustomFormFields table="externalLink" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  {tShared(msg({ id: "Save", message: "Save" }))}
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose()}>
                  {tShared(msg({ id: "Cancel", message: "Cancel" }))}
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default CustomerPortalForm;
