import {
  DatePicker,
  MultiSelect,
  Select,
  TextArea,
  ValidatedForm
} from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import { CustomFormFields, Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
  changeOrderApprovalType,
  changeOrderType,
  changeOrderValidator
} from "~/modules/items";
import { nonConformancePriority } from "~/modules/quality";
import { useItems } from "~/stores/items";
import type { ListItem } from "~/types";

type ChangeOrderFormValues = z.infer<typeof changeOrderValidator>;

type ChangeOrderFormProps = {
  initialValues: ChangeOrderFormValues;
  changeOrderTypes: ListItem[];
};

// Workflow-template picker + reviewer selector are not implemented yet.
const ChangeOrderForm = ({
  initialValues,
  changeOrderTypes
}: ChangeOrderFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const isEditing = initialValues.id !== undefined;

  const [items] = useItems();

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={changeOrderValidator}
        defaultValues={initialValues}
        className="w-full"
      >
        <CardHeader>
          <CardTitle>
            {isEditing ? "Change Order" : "New Change Order"}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              <Trans>
                A change order tracks engineering and manufacturing changes
                through review, approval, and release.
              </Trans>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <Hidden name="changeOrderId" />
          <Hidden name="sourceType" />
          <Hidden name="sourceId" />
          <Hidden name="assignee" />

          <VStack spacing={4}>
            <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
              <Input name="name" label={t`Name`} />
              <Select
                name="type"
                label={t`Type`}
                options={changeOrderType.map((type) => ({
                  label: type,
                  value: type
                }))}
              />
            </div>
            <TextArea name="description" label={t`Description`} />
            <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
              <Select
                name="changeOrderTypeId"
                label={t`Category`}
                options={changeOrderTypes.map((type) => ({
                  label: type.name,
                  value: type.id
                }))}
              />
              <Select
                name="priority"
                label={t`Priority`}
                options={nonConformancePriority.map((priority) => ({
                  label: priority,
                  value: priority
                }))}
              />
            </div>

            <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
              <Select
                name="approvalType"
                label={t`Approval Type`}
                options={changeOrderApprovalType.map((approvalType) => ({
                  label: approvalType,
                  value: approvalType
                }))}
              />
              <MultiSelect
                name="items"
                label={t`Items`}
                options={items.map((item) => ({
                  label: item.readableIdWithRevision,
                  value: item.id,
                  helper: item.name
                }))}
              />
            </div>

            <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
              <DatePicker name="openDate" label={t`Open Date`} />
              <DatePicker name="dueDate" label={t`Due Date`} />
              <DatePicker name="effectiveDate" label={t`Effective Date`} />
              <CustomFormFields table="changeOrder" />
            </div>
          </VStack>
        </CardContent>
        <CardFooter>
          <Submit
            isDisabled={
              isEditing
                ? !permissions.can("update", "parts")
                : !permissions.can("create", "parts")
            }
          >
            Save
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

export default ChangeOrderForm;
