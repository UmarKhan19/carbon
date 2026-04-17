import { InputControlled, ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { z } from "zod";
import {
  DatePicker,
  Hidden,
  Input,
  Location,
  SequenceOrCustomId,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import {
  isWarehouseTransferLocked,
  warehouseTransferValidator
} from "../../inventory.models";

type WarehouseTransferFormProps = {
  initialValues: z.infer<typeof warehouseTransferValidator>;
};

const WarehouseTransferForm = ({
  initialValues
}: WarehouseTransferFormProps) => {
  const permissions = usePermissions();
  const { t } = useLingui();
  const isEditing = !!initialValues.id;
  const isLocked = isWarehouseTransferLocked(initialValues.status);
  const canEdit =
    permissions.can("update", "inventory") &&
    ["Draft"].includes(initialValues.status ?? "");

  return (
    <ValidatedForm
      validator={warehouseTransferValidator}
      method="post"
      defaultValues={initialValues}
      className="w-full"
      isDisabled={isEditing && isLocked}
    >
      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            {isEditing ? t`Warehouse Transfer` : t`New Transfer`}
          </CardTitle>
          {!isEditing && (
            <CardDescription>
              {t`A warehouse transfer is an inter-company movement of inventory between two locations`}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <Hidden name="id" />
          <VStack spacing={4}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full items-start">
              {isEditing ? (
                <InputControlled
                  name="transferId"
                  label={t`Transfer ID`}
                  isDisabled
                  value={initialValues.transferId!}
                />
              ) : (
                <SequenceOrCustomId
                  name="transferId"
                  label={t`Transfer ID`}
                  table="warehouseTransfer"
                />
              )}
              <Input name="reference" label={t`Reference`} />
              <Location name="fromLocationId" label={t`From Location`} />
              <Location name="toLocationId" label={t`To Location`} />
              {isEditing && (
                <>
                  <DatePicker name="transferDate" label={t`Transfer Date`} />
                  <DatePicker
                    name="expectedReceiptDate"
                    label={t`Expected Receipt Date`}
                  />
                </>
              )}
            </div>

            <TextArea name="notes" label={t`Notes`} />

            <Submit disabled={!canEdit}>
              <Trans>Save</Trans>
            </Submit>
          </VStack>
        </CardContent>
      </Card>
    </ValidatedForm>
  );
};

export default WarehouseTransferForm;
