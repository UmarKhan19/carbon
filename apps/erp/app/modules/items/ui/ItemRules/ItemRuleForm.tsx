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
import type { ConditionAst } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  Hidden,
  Input,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { itemRuleValidator } from "../../items.models";
import MessageWithTokens from "./MessageWithTokens";
import RuleBuilder from "./RuleBuilder";
import SeveritySelect from "./SeveritySelect";

type ItemRuleFormInitial = Partial<z.infer<typeof itemRuleValidator>> & {
  conditionAst?: ConditionAst;
};

type ItemRuleFormProps = {
  initialValues: ItemRuleFormInitial;
  open?: boolean;
  onClose: () => void;
};

export default function ItemRuleForm({
  initialValues,
  open = true,
  onClose
}: ItemRuleFormProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();

  const isEditing = !!initialValues.id;
  const isDisabled = isEditing
    ? !permissions.can("update", "parts")
    : !permissions.can("create", "parts");

  const conditionAstInitial: ConditionAst = (initialValues.conditionAst as
    | ConditionAst
    | undefined) ?? {
    kind: "and",
    conditions: []
  };

  // ValidatedForm wants defaultValues; we hand it the scalar fields.
  // conditionAst gets driven by RuleBuilder via Hidden field.
  const defaults = {
    id: initialValues.id ?? undefined,
    name: initialValues.name ?? "",
    description: initialValues.description ?? "",
    message: initialValues.message ?? "",
    severity: initialValues.severity ?? "error",
    active: initialValues.active ?? true
  };

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open={open}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={itemRuleValidator}
            method="post"
            action={
              isEditing
                ? path.to.itemRule(initialValues.id!)
                : path.to.newItemRule
            }
            defaultValues={defaults}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? <Trans>Edit rule</Trans> : <Trans>New rule</Trans>}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />
                <TextArea
                  name="description"
                  label={t`Description`}
                  placeholder={t`Optional context for this rule`}
                />
                <SeveritySelect name="severity" />
                <Boolean
                  name="active"
                  label={t`Active`}
                  description={t`Inactive rules are skipped during evaluation but kept on items`}
                />
                <RuleBuilder
                  name="conditionAst"
                  initial={conditionAstInitial}
                />
                <MessageWithTokens name="message" />
                <CustomFormFields table="itemRule" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
                <Button variant="solid" onClick={() => onClose()}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
}
