import { Select, ValidatedForm } from "@carbon/form";
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
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { useFetcher } from "react-router";
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
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: (data?: { id: string; name: string }) => void;
};

const ChangeOrderWorkflowForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: ChangeOrderWorkflowFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<
    { id: string; name: string } | { error: string }
  >();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "production")
    : !permissions.can("create", "production");

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "idle" && fetcher.data) {
      if ("id" in fetcher.data) {
        onClose(fetcher.data);
        toast.success(t`Created template`);
      } else if ("error" in fetcher.data) {
        toast.error(t`Failed to create template: ${fetcher.data.error}`);
      }
    }
  }, [fetcher.data, fetcher.state, onClose, type, t]);

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            key={initialValues.id}
            validator={changeOrderWorkflowValidator}
            method="post"
            action={
              isEditing
                ? path.to.changeOrderWorkflow(initialValues.id!)
                : path.to.newChangeOrderWorkflow
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? t`Edit Template` : t`New Template`}
              </ModalDrawerTitle>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  A template defines the preset values for a new change order —
                  its priority, approval type, and default approvers.
                </Trans>
              </p>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
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
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="secondary" onClick={() => onClose()}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default ChangeOrderWorkflowForm;
