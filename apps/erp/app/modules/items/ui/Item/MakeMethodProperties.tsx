import { useControlField, ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { StorageUnit, Submit } from "~/components/Form";
import { useUser } from "~/hooks";
import { path } from "~/utils/path";

// Local validator. Kept colocated because it's only consumed here and the
// generated DB types may not yet know about finishToStorageUnitId on
// makeMethod (added by 20260507000003) — see TODO in the action route.
const validator = z.object({
  finishToStorageUnitId: zfd.text(z.string().optional())
});

type MakeMethodPropertiesProps = {
  makeMethodId: string;
  finishToStorageUnitId: string | null | undefined;
  isReadOnly?: boolean;
};

const MakeMethodProperties = ({
  makeMethodId,
  finishToStorageUnitId,
  isReadOnly = false
}: MakeMethodPropertiesProps) => {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success === true) {
      toast.success(t`Finish-to storage unit saved`);
    }
  }, [fetcher.state, fetcher.data, t]);

  return (
    <Card>
      <ValidatedForm
        method="post"
        action={path.to.makeMethodFinishTo(makeMethodId)}
        validator={validator}
        defaultValues={{
          finishToStorageUnitId: finishToStorageUnitId ?? undefined
        }}
        fetcher={fetcher}
      >
        <CardHeader>
          <CardTitle>
            <Trans>Make Method Properties</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Default destination shelf for finished output of this make method.
              Drives `job.finishToStorageUnitId` for new jobs created from this
              method.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-[400px]">
            <FinishToStorageUnitField />
          </div>
        </CardContent>
        <CardFooter>
          <Submit isDisabled={isReadOnly}>
            <Trans>Save</Trans>
          </Submit>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
};

// Default location comes from the user's defaults — finished-good shelves
// belong to the location where the method runs. The DB column has no
// location FK, so an operator could in principle pick any shelf, but we
// scope the picker to the user's location to keep it sane.
function FinishToStorageUnitField() {
  const { t } = useLingui();
  const { defaults } = useUser();
  const [storageUnitId, setStorageUnitId] = useControlField<string | undefined>(
    "finishToStorageUnitId"
  );

  return (
    <StorageUnit
      name="finishToStorageUnitId"
      label={t`Finish To Storage Unit`}
      helperText={t`Default destination storage unit for finished output. Optional.`}
      isClearable
      isOptional
      locationId={defaults?.locationId ?? undefined}
      value={storageUnitId ?? ""}
      onChange={(unit) => setStorageUnitId(unit?.id ?? undefined)}
    />
  );
}

export default MakeMethodProperties;
