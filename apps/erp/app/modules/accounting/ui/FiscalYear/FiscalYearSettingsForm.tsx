import { ValidatedForm } from "@carbon/form";
import { Button, HStack } from "@carbon/react";
import { useNavigate } from "react-router";
import type { z } from "zod";
import { Select, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { months } from "~/modules/shared";
import { path } from "~/utils/path";
import { fiscalYearSettingsValidator } from "../../accounting.models";

type FiscalYearSettingsField = {
  name: string;
  label: string;
  description: string;
};

const fields: FiscalYearSettingsField[] = [
  {
    name: "startMonth",
    label: "Start of Fiscal Year",
    description: "This is the month your fiscal year starts."
  },
  {
    name: "taxStartMonth",
    label: "Start of Tax Year",
    description: "This is the month your tax year starts."
  }
];

type FiscalYearSettingsFormProps = {
  initialValues: z.infer<typeof fiscalYearSettingsValidator>;
};

const FiscalYearSettingsForm = ({
  initialValues
}: FiscalYearSettingsFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const isDisabled =
    !permissions.can("update", "accounting") || !permissions.is("employee");

  return (
    <ValidatedForm
      method="post"
      action={path.to.fiscalYears}
      defaultValues={initialValues}
      validator={fiscalYearSettingsValidator}
      className="w-full"
    >
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              Fiscal Year Settings
            </h1>
            <p className="text-sm text-muted-foreground">
              Configure the start months for your fiscal and tax years
            </p>
          </div>
          <HStack>
            <Submit isDisabled={isDisabled}>Save</Submit>
            <Button size="md" variant="solid" onClick={onClose}>
              Cancel
            </Button>
          </HStack>
        </div>
        <div className="flex flex-col gap-3 p-6">
          {fields.map((field) => (
            <div
              key={field.name}
              className="group rounded-lg border border-border p-4 transition-all hover:border-muted-foreground/30"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-foreground mb-1">
                    {field.label}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {field.description}
                  </p>
                </div>
                <div className="flex-shrink-0 w-64">
                  <Select
                    name={field.name}
                    options={months.map((month) => ({
                      label: month,
                      value: month
                    }))}
                    size="sm"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ValidatedForm>
  );
};

export default FiscalYearSettingsForm;
