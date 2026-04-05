import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  toast,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import type { z } from "zod";
import {
  CustomerLocation,
  CustomFormFields,
  Hidden,
  Input,
  PhoneInput,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { useAsyncFetcher } from "~/hooks/useAsyncFetcher";
import { path } from "~/utils/path";
import { customerContactValidator } from "../../sales.models";

type CustomerContactFormProps = {
  customerId: string;
  initialValues: z.infer<typeof customerContactValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const CustomerContactForm = ({
  customerId,
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: CustomerContactFormProps) => {
  const { _: t } = useLingui();
  const { _: tShared } = useLingui();
  const fetcher = useAsyncFetcher<{ success?: boolean; message: string }>({
    onStateChange(state) {
      if (state === "idle" && fetcher.data && !fetcher.data.success) {
        toast.error(fetcher.data.message);
      }
    }
  });

  const permissions = usePermissions();
  const isEditing = !!initialValues?.id;
  const isDisabled = isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

  return (
    <Drawer
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={customerContactValidator}
          method="post"
          action={
            isEditing
              ? path.to.customerContact(customerId, initialValues.id!)
              : path.to.newCustomerContact(customerId)
          }
          defaultValues={initialValues}
          // @ts-expect-error TODO: ValidatedForm types doesn't yet support useAsyncFetcher - @sidwebworks
          fetcher={fetcher}
          className="flex flex-col h-full"
          onAfterSubmit={() => {
            if (type === "modal") {
              onClose?.();
            }
          }}
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing
                ? tShared(msg({ id: "Edit", message: "Edit" }))
                : tShared(msg({ id: "New", message: "New" }))}{" "}
              {t(msg({ id: "Contact", message: "Contact" }))}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="type" value={type} />
            <Hidden name="contactId" />
            <VStack spacing={4}>
              <Input
                name="email"
                label={tShared(msg({ id: "Email", message: "Email" }))}
              />
              <Input
                name="firstName"
                label={tShared(
                  msg({ id: "First Name", message: "First Name" })
                )}
              />
              <Input
                name="lastName"
                label={tShared(msg({ id: "Last Name", message: "Last Name" }))}
              />
              <Input
                name="title"
                label={t(msg({ id: "Title", message: "Title" }))}
              />
              <PhoneInput
                name="mobilePhone"
                label={t(msg({ id: "Mobile Phone", message: "Mobile Phone" }))}
              />
              <PhoneInput
                name="homePhone"
                label={t(msg({ id: "Home Phone", message: "Home Phone" }))}
              />
              <PhoneInput
                name="workPhone"
                label={t(msg({ id: "Work Phone", message: "Work Phone" }))}
              />
              <PhoneInput
                name="fax"
                label={t(msg({ id: "Fax", message: "Fax" }))}
              />
              <CustomerLocation
                name="customerLocationId"
                label={t(msg({ id: "Location", message: "Location" }))}
                customer={customerId}
              />
              <TextArea
                name="notes"
                label={t(msg({ id: "Notes", message: "Notes" }))}
              />
              <CustomFormFields table="customerContact" />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
                {tShared(msg({ id: "Save", message: "Save" }))}
              </Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                {tShared(msg({ id: "Cancel", message: "Cancel" }))}
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default CustomerContactForm;
