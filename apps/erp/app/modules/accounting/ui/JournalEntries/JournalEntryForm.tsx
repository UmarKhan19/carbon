import { ValidatedForm } from "@carbon/form";
import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import type { z } from "zod";
import { Hidden, Input, Select, Submit } from "~/components/Form";
import {
  journalEntryTypes,
  journalEntryValidator
} from "../../accounting.models";

type JournalEntryFormProps = {
  initialValues: z.infer<typeof journalEntryValidator>;
  isDisabled?: boolean;
};

const entryTypeOptions = journalEntryTypes.map((t) => ({
  label: t,
  value: t
}));

const JournalEntryForm = ({
  initialValues,
  isDisabled = false
}: JournalEntryFormProps) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Journal Entry</CardTitle>
      </CardHeader>
      <CardContent>
        <ValidatedForm
          validator={journalEntryValidator}
          method="post"
          defaultValues={initialValues}
        >
          <Hidden name="id" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              name="postingDate"
              label="Posting Date"
              type="date"
              isReadOnly={isDisabled}
            />
            <Select
              name="entryType"
              label="Entry Type"
              options={entryTypeOptions}
              placeholder="Select type..."
              isClearable
              isReadOnly={isDisabled}
            />
            <div className="md:col-span-2">
              <Input
                name="description"
                label="Description"
                isReadOnly={isDisabled}
              />
            </div>
          </div>
          {!isDisabled && (
            <div className="flex justify-end mt-4">
              <Submit>Save</Submit>
            </div>
          )}
        </ValidatedForm>
      </CardContent>
    </Card>
  );
};

export default JournalEntryForm;
