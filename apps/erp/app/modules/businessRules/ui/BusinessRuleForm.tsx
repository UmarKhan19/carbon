import { Boolean, ValidatedForm } from "@carbon/form";
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
import {
  type Condition,
  type ConditionAst,
  SURFACES_BY_TARGET_TYPE,
  TRANSACTION_SURFACES
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Input,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { businessRuleValidator } from "../businessRules.models";
import MessageWithTokens from "./MessageWithTokens";
import RuleBuilder from "./RuleBuilder";
import SeveritySelect from "./SeveritySelect";
import SurfacesField from "./SurfacesField";

type BusinessRuleFormInitial = Partial<
  z.infer<typeof businessRuleValidator>
> & {
  conditionAst?: ConditionAst;
};

type BusinessRuleFormProps = {
  initialValues: BusinessRuleFormInitial;
  open?: boolean;
  onClose: () => void;
};

export default function BusinessRuleForm({
  initialValues,
  open = true,
  onClose
}: BusinessRuleFormProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();

  const isEditing = !!initialValues.id;
  const isDisabled = isEditing
    ? !permissions.can("update", "settings")
    : !permissions.can("create", "settings");

  const conditionAstInitial: ConditionAst = (initialValues.conditionAst as
    | ConditionAst
    | undefined) ?? {
    kind: "all",
    conditions: []
  };

  // Live mirror of the AST conditions, kept in sync via RuleBuilder's
  // callback. MessageWithTokens reads it to offer per-condition tokens
  // (`{condition[0].value}`, etc.) that resolve to the rule's required
  // value at eval time — independent of the runtime ctx.
  const [liveConditions, setLiveConditions] = useState<Condition[]>(
    conditionAstInitial.conditions
  );

  const targetType = (initialValues.targetType ?? "item") as
    | "item"
    | "storageUnit"
    | "workCenter";

  // Default new rules to all surfaces of the chosen targetType. Editing keeps
  // whatever was saved.
  const defaultSurfaces =
    initialValues.surfaces ??
    TRANSACTION_SURFACES.filter((s) =>
      SURFACES_BY_TARGET_TYPE[targetType].includes(s as never)
    );

  // ValidatedForm wants defaultValues; we hand it the scalar fields.
  // conditionAst gets driven by RuleBuilder via Hidden field.
  const defaults = {
    id: initialValues.id ?? undefined,
    name: initialValues.name ?? "",
    description: initialValues.description ?? "",
    message: initialValues.message ?? "",
    severity: initialValues.severity ?? "error",
    targetType,
    appliesToAll: initialValues.appliesToAll ?? false,
    active: initialValues.active ?? true,
    surfaces: defaultSurfaces
  };

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open={open}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
      >
        <ModalDrawerContent size="lg">
          <ValidatedForm
            validator={businessRuleValidator}
            method="post"
            action={
              isEditing
                ? path.to.businessRule(initialValues.id!)
                : path.to.newBusinessRule
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
              <Hidden name="targetType" />
              <VStack spacing={4}>
                <HStack className="w-full gap-x-4">
                  <Input name="name" label={t`Name`} />

                  <div className="shrink-0 pb-2">
                    <Boolean variant="large" name="active" label={t`Active`} />
                  </div>
                </HStack>
                <TextArea
                  name="description"
                  label={t`Description`}
                  placeholder={t`Optional context for this rule`}
                />
                <SeveritySelect name="severity" />
                <Boolean
                  name="appliesToAll"
                  label={
                    targetType === "item"
                      ? t`Applies to all items`
                      : targetType === "storageUnit"
                        ? t`Applies to all storage units`
                        : t`Applies to all work centers`
                  }
                  description={t`When on, this rule fires for every target of its type. Assignment rows are ignored but preserved.`}
                />
                <SurfacesField name="surfaces" targetType={targetType} />
                <RuleBuilder
                  name="conditionAst"
                  initial={conditionAstInitial}
                  onConditionsChange={setLiveConditions}
                  targetType={targetType}
                />
                <MessageWithTokens
                  name="message"
                  conditions={liveConditions}
                  targetType={targetType}
                />
                <CustomFormFields table="businessRule" />
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
