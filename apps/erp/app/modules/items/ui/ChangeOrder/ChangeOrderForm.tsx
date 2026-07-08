import {
  CreatableCombobox,
  DatePicker,
  MultiSelect,
  Select,
  SelectControlled,
  TextArea,
  useField,
  ValidatedForm
} from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  FormControl,
  FormErrorMessage,
  FormLabel,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useRef, useState } from "react";
import type { z } from "zod";
import { CustomFormFields, Hidden, Input, Submit } from "~/components/Form";
import { UserSelect } from "~/components/Selectors";
import type { IndividualOrGroup } from "~/components/Selectors/UserSelect/types";
import { usePermissions } from "~/hooks";
import type { ChangeOrderWorkflow } from "~/modules/items";
import {
  changeOrderApprovalType,
  changeOrderCreateValidator,
  changeOrderPriority,
  changeOrderType,
  parseChangeOrderWorkflowContent
} from "~/modules/items";
import { ChangeOrderWorkflowForm } from "~/modules/items/ui/ChangeOrderWorkflow";
import { latestRevisionByReadableId, useItems } from "~/stores/items";

type ChangeOrderFormValues = z.infer<typeof changeOrderCreateValidator>;

type ChangeOrderFormProps = {
  initialValues: ChangeOrderFormValues;
  changeOrderWorkflows: ChangeOrderWorkflow[];
};

const ChangeOrderForm = ({
  initialValues,
  changeOrderWorkflows
}: ChangeOrderFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const isEditing = initialValues.id !== undefined;

  // Local state for the fields a workflow template pre-fills. Selecting a
  // workflow copies its priority, approvalType, and default approver groups
  // into these controlled fields (client-side, like the Issue onWorkflowChange).
  const [workflow, setWorkflow] = useState<{
    priority: string;
    approvalType: string;
    approvers: string[];
  }>({
    priority: initialValues.priority ?? "",
    approvalType: initialValues.approvalType ?? "Unanimous",
    approvers: initialValues.approvers ?? []
  });

  const onWorkflowChange = (value: { value: string } | null) => {
    if (!value) return;
    const selected = changeOrderWorkflows.find((w) => w.id === value.value);
    if (!selected) return;
    const content = parseChangeOrderWorkflowContent(selected.content);
    setWorkflow((prev) => ({
      priority: content.priority ?? "",
      approvalType: content.approvalType ?? prev.approvalType,
      approvers: content.approvers ?? []
    }));
  };

  // Create a template inline via a modal (no navigation, so the half-filled
  // change order isn't lost). On close the dropdown reopens so the revalidated
  // list shows the new template, ready to select (which applies its presets).
  const newTemplateModal = useDisclosure();
  const [newTemplateName, setNewTemplateName] = useState("");
  const templateTriggerRef = useRef<HTMLButtonElement>(null);

  const [items] = useItems();

  // Change orders apply to active Parts and Tools only, one option per part
  // (the latest revision); obsolete revisions are active === false and excluded.
  const itemOptions = useMemo(
    () =>
      latestRevisionByReadableId(
        items.filter(
          (item) =>
            (item.type === "Part" || item.type === "Tool") && item.active
        )
      ).map((item) => ({
        label: item.readableIdWithRevision,
        value: item.id,
        helper: item.name
      })),
    [items]
  );

  return (
    <Card>
      <ValidatedForm
        method="post"
        validator={changeOrderCreateValidator}
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
              <SelectControlled
                name="priority"
                label={t`Priority`}
                options={changeOrderPriority.map((priority) => ({
                  label: priority,
                  value: priority
                }))}
                value={workflow.priority}
                onChange={(value) => {
                  setWorkflow({
                    ...workflow,
                    priority: value?.value ?? ""
                  });
                }}
              />
              <SelectControlled
                name="approvalType"
                label={t`Approval Type`}
                options={changeOrderApprovalType.map((approvalType) => ({
                  label: approvalType,
                  value: approvalType
                }))}
                value={workflow.approvalType}
                onChange={(value) => {
                  setWorkflow((prev) => ({
                    ...prev,
                    approvalType: value?.value ?? ""
                  }));
                }}
              />
            </div>

            <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2 md:items-start">
              <CreatableCombobox
                ref={templateTriggerRef}
                name="changeOrderWorkflowId"
                label={t`Template`}
                options={changeOrderWorkflows.map((workflow) => ({
                  label: workflow.name,
                  value: workflow.id
                }))}
                onChange={onWorkflowChange}
                onCreateOption={(option) => {
                  setNewTemplateName(option);
                  newTemplateModal.onOpen();
                }}
              />
              <ApproversField
                approvers={workflow.approvers}
                onChange={(selections) => {
                  setWorkflow((prev) => ({
                    ...prev,
                    // A group loads without members, so it has no `users` key
                    // at runtime — discriminate on a field only groups carry.
                    approvers: selections.map((item) =>
                      "isEmployeeTypeGroup" in item
                        ? `group_${item.id}`
                        : `user_${item.id}`
                    )
                  }));
                }}
              />
            </div>

            <MultiSelect name="items" label={t`Items`} options={itemOptions} />

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
                ? !permissions.can("update", "production")
                : !permissions.can("create", "production")
            }
          >
            Save
          </Submit>
        </CardFooter>
      </ValidatedForm>
      {newTemplateModal.isOpen && (
        <ChangeOrderWorkflowForm
          type="modal"
          initialValues={{
            name: newTemplateName,
            priority: "Medium",
            approvalType: "Unanimous",
            approvers: []
          }}
          onClose={() => {
            setNewTemplateName("");
            newTemplateModal.onClose();
            // Reopen the dropdown so the revalidated list shows the new template.
            templateTriggerRef.current?.click();
          }}
        />
      )}
    </Card>
  );
};

export default ChangeOrderForm;

// The approvers control is a custom UserSelect (not a registered form field), so
// its validation error needs to be surfaced explicitly. Rendered inside the
// ValidatedForm so useField("approvers") can read the error and drive isInvalid.
function ApproversField({
  approvers,
  onChange
}: {
  approvers: string[];
  onChange: (selections: IndividualOrGroup[]) => void;
}) {
  const { t } = useLingui();
  const { error } = useField("approvers");
  return (
    <FormControl isInvalid={!!error}>
      <FormLabel htmlFor="approvers">{t`Approvers`}</FormLabel>
      {approvers.map((approver, index) => (
        <input
          key={`approvers[${index}]`}
          type="hidden"
          name={`approvers[${index}]`}
          value={approver}
        />
      ))}
      <UserSelect
        isMulti
        type="employee"
        value={approvers.map((a) => a.replace(/^(user|group)_/, ""))}
        onChange={onChange}
      />
      {error && <FormErrorMessage>{error}</FormErrorMessage>}
    </FormControl>
  );
}
