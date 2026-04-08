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
import { useLingui } from "@lingui/react/macro";
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
  const { t } = useLingui();
  const { t: tShared } = useLingui();
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
                ? tShared({ id: "Edit", message: "Edit" })
                : tShared({ id: "New", message: "New" })}{" "}
              {t({ id: "Contact", message: "Contact" })}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="type" value={type} />
            <Hidden name="contactId" />
            <VStack spacing={4}>
              <Input
                name="email"
                label={tShared({ id: "Email", message: "Email" })}
              />
              <Input
                name="firstName"
                label={tShared({ id: "First Name", message: "First Name" })}
              />
              <Input
                name="lastName"
                label={tShared({ id: "Last Name", message: "Last Name" })}
              />
              <Input
                name="title"
                label={t({ id: "Title", message: "Title" })}
              />
              <PhoneInput
                name="mobilePhone"
                label={t({ id: "Mobile Phone", message: "Mobile Phone" })}
              />
              <PhoneInput
                name="homePhone"
                label={t({ id: "Home Phone", message: "Home Phone" })}
              />
              <PhoneInput
                name="workPhone"
                label={t({ id: "Work Phone", message: "Work Phone" })}
              />
              <PhoneInput name="fax" label={t({ id: "Fax", message: "Fax" })} />
              <CustomerLocation
                name="customerLocationId"
                label={t({ id: "Location", message: "Location" })}
                customer={customerId}
              />
              <TextArea
                name="notes"
                label={t({ id: "Notes", message: "Notes" })}
              />
              <CustomFormFields table="customerContact" />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
                {tShared({ id: "Save", message: "Save" })}
              </Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                {tShared({ id: "Cancel", message: "Cancel" })}
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default CustomerContactForm;
