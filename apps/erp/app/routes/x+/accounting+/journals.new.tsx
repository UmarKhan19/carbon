import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
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
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useNavigate } from "react-router";
import { Input, Select, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
  createJournalEntry,
  journalEntryTypes,
  journalEntryValidator
} from "~/modules/accounting";
import { getNextSequence } from "~/modules/settings";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(journalEntryValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const nextSequence = await getNextSequence(client, "journalEntry", companyId);

  if (nextSequence.error) {
    return data(
      {},
      await flash(
        request,
        error(nextSequence.error, "Failed to get next sequence")
      )
    );
  }

  const result = await createJournalEntry(client, {
    ...validation.data,
    journalEntryId: nextSequence.data,
    companyId,
    createdBy: userId
  });

  if (result.error) {
    return data(
      {},
      await flash(
        request,
        error(result.error, "Failed to create journal entry")
      )
    );
  }

  throw redirect(
    path.to.journalEntryDetails(String(result.data.id)),
    await flash(request, success("Journal entry created"))
  );
}

const entryTypeOptions = journalEntryTypes.map((t) => ({
  label: t,
  value: t
}));

export default function NewJournalEntryRoute() {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const isDisabled = !permissions.can("create", "accounting");

  const onClose = () => navigate(-1);

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={journalEntryValidator}
            method="post"
            defaultValues={{
              postingDate: new Date().toISOString().split("T")[0],
              description: "",
              entryType: undefined
            }}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>New Journal Entry</ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <Input name="postingDate" label="Posting Date" type="date" />
                <Select
                  name="entryType"
                  label="Entry Type"
                  options={entryTypeOptions}
                  placeholder="Select type..."
                  isClearable
                />
                <Input name="description" label="Description" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Create</Submit>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
}
