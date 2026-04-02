import { ValidatedForm } from "@carbon/form";
import {
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
import type { z } from "zod";
import { Account, Hidden, Input, Number, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { journalEntryLineValidator } from "../../accounting.models";

type JournalEntryLineFormProps = {
  initialValues: z.infer<typeof journalEntryLineValidator>;
  open?: boolean;
  onClose: () => void;
};

const JournalEntryLineForm = ({
  initialValues,
  open = true,
  onClose
}: JournalEntryLineFormProps) => {
  const permissions = usePermissions();
  const isEditing = !!initialValues.id;
  const isDisabled = !permissions.can(
    isEditing ? "update" : "create",
    "accounting"
  );

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={journalEntryLineValidator}
            method="post"
            defaultValues={initialValues}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit Line" : "New Line"}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="journalEntryId" />
              <VStack spacing={4}>
                <Account name="accountNumber" label="Account" />
                <Number name="debit" label="Debit" minValue={0} />
                <Number name="credit" label="Credit" minValue={0} />
                <Input name="description" label="Description" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  {isEditing ? "Update" : "Add Line"}
                </Submit>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default JournalEntryLineForm;
