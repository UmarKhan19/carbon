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
  VStack
} from "@carbon/react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { Boolean, Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { storageTypeValidator } from "../../items.models";

type StorageTypeFormProps = {
  initialValues: Partial<z.infer<typeof storageTypeValidator>>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const StorageTypeForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: StorageTypeFormProps) => {
  const fetcher = useFetcher<{}>();
  const permissions = usePermissions();
  const isEditing = !!initialValues?.id;
  const isDisabled = isEditing
    ? !permissions.can("update", "parts")
    : !permissions.can("create", "parts");

  const action = isEditing
    ? path.to.storageType(initialValues.id!)
    : path.to.newStorageType;

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
            validator={storageTypeValidator}
            method="post"
            action={action}
            defaultValues={initialValues}
            fetcher={type === "modal" ? fetcher : undefined}
            onSubmit={() => {
              if (type === "modal") onClose?.();
            }}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} Storage Type
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <Hidden name="id" />
                <Input name="name" label="Name" />
                <Input name="description" label="Description" />
                {isEditing && <Boolean name="active" label="Active" />}
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  Cancel
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default StorageTypeForm;
