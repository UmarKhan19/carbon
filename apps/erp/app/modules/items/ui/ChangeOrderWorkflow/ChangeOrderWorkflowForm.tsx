import { Select, ValidatedForm } from "@carbon/form";
import { Button, Heading, HStack, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import { Hidden, Input, Submit, Users } from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
  changeOrderApprovalType,
  changeOrderPriority,
  changeOrderWorkflowValidator
} from "~/modules/items";
import { path } from "~/utils/path";

type ChangeOrderWorkflowFormProps = {
  initialValues: z.infer<typeof changeOrderWorkflowValidator>;
  onClose: () => void;
};

const ChangeOrderWorkflowForm = ({
  initialValues,
  onClose
}: ChangeOrderWorkflowFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "production")
    : !permissions.can("create", "production");

  return (
    <ValidatedForm
      key={initialValues.id}
      validator={changeOrderWorkflowValidator}
      defaultValues={initialValues}
      method="post"
      action={
        isEditing
          ? path.to.changeOrderWorkflow(initialValues.id!)
          : path.to.newChangeOrderWorkflow
      }
    >
      <Hidden name="id" value={initialValues.id} />
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[50rem] h-full mx-auto gap-2"
      >
        <HStack className="w-full justify-between">
          <VStack spacing={0}>
            <Heading size="h3">
              {isEditing ? "Edit" : "New"}{" "}
              <span className="hidden md:inline">Change Order</span> Workflow
            </Heading>
            <p className="text-sm text-muted-foreground">
              Change order workflows define the preset values for a new change
              order — its priority, approval type, and default approvers.
            </p>
          </VStack>
        </HStack>
        <Input name="name" label={t`Name`} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
          <Select
            name="priority"
            label={t`Priority`}
            options={changeOrderPriority.map((priority) => ({
              label: priority,
              value: priority
            }))}
          />
          <Select
            name="approvalType"
            label={t`Approval Type`}
            options={changeOrderApprovalType.map((approvalType) => ({
              label: approvalType,
              value: approvalType
            }))}
          />
        </div>
        <Users
          name="approvers"
          label={t`Default Approvers`}
          type="employee"
          verbose
        />

        <HStack className="w-full justify-end">
          <Button variant="secondary" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Submit isDisabled={isDisabled}>
            <Trans>Save</Trans>
          </Submit>
        </HStack>
      </VStack>
    </ValidatedForm>
  );
};

export default ChangeOrderWorkflowForm;
