import {
  Boolean as BooleanField,
  DatePicker,
  Radios,
  Submit,
  ValidatedForm
} from "@carbon/form";
import { Checkbox, DrawerBody, DrawerFooter, HStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { usePermissions } from "~/hooks";
import { postingSyncSettingsValidator } from "~/modules/settings/settings.models";

/**
 * Local structural mirror of @carbon/ee/accounting's PostingSyncSettings
 * (z.output of PostingSyncSettingsSchema). Deliberately NOT imported (even
 * type-only) to keep this component's type graph light: marginal additions
 * around the settings module push unrelated supabase select-string parses
 * over TS2589's instantiation-depth limit (see SyncActivity.tsx and the
 * note in ./index.ts — this component isn't barrel-exported for the same
 * reason). The route passes the resolved settings, so drift fails
 * typecheck at that call site.
 */
export type PostingSyncSettingsValues = {
  enabled: boolean;
  /** Overrides the default source-type list when present. */
  sourceTypes?: string[];
  includeManual: boolean;
  consolidation: "individual" | "daily";
  periodLockPolicy: "park" | "redate";
  lockDate?: string;
};

type PostingSyncSettingsProps = {
  settings: PostingSyncSettingsValues;
  /** Full pushable source-type list (the defaults), provided by the loader. */
  sourceTypeOptions: string[];
};

export function PostingSyncSettings({
  settings,
  sourceTypeOptions
}: PostingSyncSettingsProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "settings");

  // No stored override means the defaults (the full list) are enabled.
  const [enabledSourceTypes, setEnabledSourceTypes] = useState<string[]>(
    () => settings.sourceTypes ?? sourceTypeOptions
  );
  const [includeManual, setIncludeManual] = useState(settings.includeManual);

  const toggleSourceType = (sourceType: string, checked: boolean) => {
    setEnabledSourceTypes((current) =>
      checked
        ? [...current.filter((value) => value !== sourceType), sourceType]
        : current.filter((value) => value !== sourceType)
    );
  };

  return (
    <ValidatedForm
      validator={postingSyncSettingsValidator}
      method="post"
      defaultValues={{
        intent: "update-posting-settings",
        enabled: settings.enabled,
        consolidation: settings.consolidation,
        periodLockPolicy: settings.periodLockPolicy,
        lockDate: settings.lockDate
      }}
      className="flex h-full min-h-0 flex-1 flex-col"
    >
      <input type="hidden" name="intent" value="update-posting-settings" />
      {enabledSourceTypes
        .filter((sourceType) => sourceTypeOptions.includes(sourceType))
        .map((sourceType) => (
          <input
            key={sourceType}
            type="hidden"
            name="sourceTypes"
            value={sourceType}
          />
        ))}
      {includeManual && <input type="hidden" name="includeManual" value="on" />}
      <DrawerBody className="gap-6">
        <BooleanField
          name="enabled"
          bordered
          label={t`Enable posting sync`}
          description={t`Push posted journals for the enabled source types to the accounting provider.`}
        />

        <section className="flex w-full flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-foreground/70">
              <Trans>Source types</Trans>
            </span>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Posted journals with these source types are pushed.
                Document-backed journals (invoices, payments) are always
                excluded — the synced document already books them.
              </Trans>
            </p>
          </div>
          <div className="flex w-full flex-col divide-y divide-border rounded-lg border border-border">
            {sourceTypeOptions.map((sourceType) => {
              const checked = enabledSourceTypes.includes(sourceType);
              return (
                <div
                  key={sourceType}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <Checkbox
                    id={`postingSourceType:${sourceType}`}
                    checked={checked}
                    disabled={!canUpdate}
                    onCheckedChange={(next) =>
                      toggleSourceType(sourceType, next === true)
                    }
                  />
                  <label
                    htmlFor={`postingSourceType:${sourceType}`}
                    className="cursor-pointer text-sm"
                  >
                    {sourceType}
                  </label>
                </div>
              );
            })}
          </div>
          <div className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5">
            <Checkbox
              id="postingSourceType:Manual"
              checked={includeManual}
              disabled={!canUpdate}
              onCheckedChange={(next) => setIncludeManual(next === true)}
            />
            <div className="flex flex-col">
              <label
                htmlFor="postingSourceType:Manual"
                className="cursor-pointer text-sm"
              >
                <Trans>Manual</Trans>
              </label>
              <span className="text-xs text-muted-foreground">
                <Trans>
                  Manual journals are pushed only when explicitly enabled.
                </Trans>
              </span>
            </div>
          </div>
        </section>

        <section className="flex w-full flex-col gap-3 border-t border-border pt-4">
          <Radios
            name="consolidation"
            label={t`Consolidation`}
            options={[
              { label: t`Individual`, value: "individual" },
              { label: t`Daily summary`, value: "daily" }
            ]}
          />
          <p className="text-xs text-muted-foreground">
            <Trans>
              Individual pushes one provider journal per Carbon journal. Daily
              summary pushes one aggregated journal per posting date.
            </Trans>
          </p>
        </section>

        <section className="flex w-full flex-col gap-3 border-t border-border pt-4">
          <Radios
            name="periodLockPolicy"
            label={t`Period lock policy`}
            options={[
              { label: t`Park as error`, value: "park" },
              { label: t`Re-date to first open day`, value: "redate" }
            ]}
          />
          <p className="text-xs text-muted-foreground">
            <Trans>
              What happens when a journal is dated in a locked period: park it
              as a warning to fix, or push it re-dated to the first open day
              with the original date in the narration.
            </Trans>
          </p>
        </section>

        <section className="flex w-full flex-col gap-3 border-t border-border pt-4">
          <DatePicker name="lockDate" label={t`Books lock date (manual)`} />
          <p className="text-xs text-muted-foreground">
            <Trans>
              Journals dated on or before this date are treated as locked.
              Merged with the provider-reported lock date when both exist.
            </Trans>
          </p>
        </section>
      </DrawerBody>
      <DrawerFooter>
        <HStack>
          <Submit isDisabled={!canUpdate}>
            <Trans>Save</Trans>
          </Submit>
        </HStack>
      </DrawerFooter>
    </ValidatedForm>
  );
}
