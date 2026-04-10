import type {
  IntegrationAction,
  IntegrationSetting,
  IntegrationSettingGroup,
  IntegrationSettingOption
} from "@carbon/ee";
import { integrations as availableIntegrations } from "@carbon/ee";
import {
  Boolean,
  Array as FormArray,
  Input,
  Number as NumberInput,
  Password,
  Select,
  Submit,
  useControlField,
  ValidatedForm
} from "@carbon/form";
import {
  Badge,
  Button,
  cn,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  Heading,
  HStack,
  ScrollArea,
  toast,
  VStack
} from "@carbon/react";
import { SUPPORT_EMAIL } from "@carbon/utils";
import { useCallback, useMemo, useState } from "react";
import { LuCheck } from "react-icons/lu";
import { useParams } from "react-router";
import { Processes } from "~/components/Form";
import { MethodIcon, TrackingTypeIcon } from "~/components/Icons";
import { usePermissions, useUser } from "~/hooks";
import { path } from "~/utils/path";

function IntegrationActionButton({
  action,
  isDisabled
}: {
  action: IntegrationAction;
  isDisabled: boolean;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "running" | "completed">(
    "idle"
  );

  const handleClick = useCallback(async () => {
    setIsLoading(true);
    setStatus("running");

    try {
      const response = await fetch(action.endpoint, { method: "POST" });
      const data = await response.json();

      if (data.success) {
        toast.success(`${action.label} started`);
        setStatus("completed");
      } else {
        setStatus("idle");
        toast.error(data.error || `Failed to start ${action.label}`);
      }
    } catch {
      setStatus("idle");
      toast.error(`Failed to start ${action.label}`);
    } finally {
      setIsLoading(false);
    }
  }, [action]);

  return (
    <div className="flex items-center justify-between gap-4 p-3 border rounded-lg w-full">
      <div className="flex flex-col flex-1 min-w-0">
        <p className="text-sm font-medium">{action.label}</p>
        <p className="text-xs text-muted-foreground">{action.description}</p>
      </div>
      <div className="shrink-0">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleClick}
          isLoading={isLoading}
          isDisabled={isDisabled || status === "running"}
        >
          {status === "completed" ? "Started" : "Run"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Helper to normalize option to consistent format
 */
function normalizeOption(option: IntegrationSettingOption): {
  value: string;
  label: string;
  description?: string;
} {
  if (typeof option === "string") {
    return { value: option, label: option };
  }
  return option;
}

/**
 * Wrapper that hides a setting field when its `visibleWhen` condition
 * does not match the current value of the referenced field.
 *
 * Must be mounted as a dedicated component so `useControlField` is only
 * called when `visibleWhen` is defined (satisfies the rules of hooks).
 */
function ConditionalSettingField({ setting }: { setting: IntegrationSetting }) {
  const condition = setting.visibleWhen!;
  const [value] = useControlField<unknown>(condition.field);
  const current = value == null ? "" : String(value);
  const equals = Array.isArray(condition.equals)
    ? condition.equals
    : [condition.equals];
  if (!equals.includes(current)) return null;
  return <SettingFieldInner setting={setting} />;
}

/**
 * Renders a single setting field based on its type,
 * honouring any `visibleWhen` gating.
 */
function SettingField({ setting }: { setting: IntegrationSetting }) {
  if (setting.visibleWhen) {
    return <ConditionalSettingField setting={setting} />;
  }
  return <SettingFieldInner setting={setting} />;
}

function SettingFieldInner({ setting }: { setting: IntegrationSetting }) {
  switch (setting.type) {
    case "text":
      return (
        <div className="w-full">
          <Input
            name={setting.name}
            label={setting.label}
            isOptional={!setting.required}
          />
          {setting.description && (
            <p className="text-xs text-muted-foreground mt-1.5">
              {setting.description}
            </p>
          )}
        </div>
      );

    case "number":
      return (
        <div className="w-full">
          <NumberInput
            name={setting.name}
            label={setting.label}
            isRequired={setting.required}
          />
          {setting.description && (
            <p className="text-xs text-muted-foreground mt-1.5">
              {setting.description}
            </p>
          )}
        </div>
      );

    case "password":
      return (
        <div className="w-full">
          <Password name={setting.name} label={setting.label} />
          {setting.description && (
            <p className="text-xs text-muted-foreground mt-1.5">
              {setting.description}
            </p>
          )}
        </div>
      );

    case "cards":
      return <CardSelector setting={setting} />;

    case "switch":
      return (
        <div className="flex items-center justify-between gap-4 w-full py-2">
          <div className="flex flex-col flex-1">
            <span className="text-sm font-medium">{setting.label}</span>
            {setting.description && (
              <span className="text-xs text-muted-foreground">
                {setting.description}
              </span>
            )}
          </div>
          <div className="shrink-0">
            <Boolean name={setting.name} />
          </div>
        </div>
      );

    case "processes":
      return (
        <div className="w-full">
          <Processes name={setting.name} label={setting.label} />
          {setting.description && (
            <p className="text-xs text-muted-foreground mt-1">
              {setting.description}
            </p>
          )}
        </div>
      );

    case "array":
      return (
        <div className="w-full">
          <FormArray name={setting.name} label={setting.label} />
          {setting.description && (
            <p className="text-xs text-muted-foreground mt-1">
              {setting.description}
            </p>
          )}
        </div>
      );

    case "options": {
      const options =
        setting.listOptions?.map((option) => {
          const normalized = normalizeOption(option);
          let icon: JSX.Element | null = null;

          // Legacy icon support for specific field names
          if (setting.name === "methodType") {
            icon = <MethodIcon type={normalized.value} />;
          } else if (setting.name === "trackingType") {
            icon = <TrackingTypeIcon type={normalized.value} />;
          }

          // Build a simpler label that works well with Radix Select
          const label = (
            <span key={normalized.value} className="flex items-center gap-2">
              {icon}
              <span className="font-medium">{normalized.label}</span>
              {normalized.description && (
                <span className="text-muted-foreground text-xs">
                  — {normalized.description}
                </span>
              )}
            </span>
          );

          return {
            label,
            value: normalized.value
          };
        }) ?? [];

      return (
        <div className="w-full">
          <Select name={setting.name} label={setting.label} options={options} />
          {setting.description && (
            <p className="text-xs text-muted-foreground mt-1">
              {setting.description}
            </p>
          )}
        </div>
      );
    }

    default:
      return null;
  }
}

/**
 * Visual card-based selector for required, mutually-exclusive options.
 * Used for fields like a "provider" / "delivery method" choice where a
 * dropdown would be clunkier than clickable cards.
 */
function CardSelector({ setting }: { setting: IntegrationSetting }) {
  const [value, setValue] = useControlField<string>(setting.name);
  const options = (setting.listOptions ?? []).map(normalizeOption);
  const current = value == null ? "" : String(value);

  return (
    <div className="w-full">
      {setting.label && (
        <div className="flex flex-col gap-0.5">
          <div className="text-sm font-medium text-foreground">
            {setting.label}
          </div>
          {setting.description && (
            <p className="text-xs text-muted-foreground">
              {setting.description}
            </p>
          )}
        </div>
      )}
      <div
        role="radiogroup"
        aria-label={setting.label}
        className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {options.map((option) => {
          const isSelected = current === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setValue(option.value)}
              className={cn(
                "group relative flex flex-col gap-1 rounded-lg border p-3 text-left transition-all",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                isSelected
                  ? "border-foreground/60 bg-foreground/[0.03]"
                  : "border-border hover:border-foreground/30"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-foreground truncate">
                  {option.label}
                </div>
                <span
                  className={cn(
                    "inline-flex size-[1.125rem] shrink-0 items-center justify-center rounded-full transition-colors",
                    isSelected
                      ? "bg-foreground text-background"
                      : "border border-muted-foreground/30"
                  )}
                  aria-hidden
                >
                  {isSelected && <LuCheck className="size-3 stroke-[3]" />}
                </span>
              </div>
              {option.description && (
                <p className="text-xs leading-snug text-muted-foreground">
                  {option.description}
                </p>
              )}
            </button>
          );
        })}
      </div>
      {/* Hidden input keeps the value in form data on submit */}
      <input type="hidden" name={setting.name} value={current} />
    </div>
  );
}

/**
 * Wrapper that hides an entire group when every setting in it is gated
 * by the same `visibleWhen` field and none of them are currently visible.
 * Only mounted when the group actually shares a single `visibleWhen` field.
 */
function GatedSettingsGroup({
  name,
  description,
  settings,
  controlledField
}: {
  name: string;
  description?: string;
  settings: IntegrationSetting[];
  controlledField: string;
}) {
  const [value] = useControlField<unknown>(controlledField);
  const current = value == null ? "" : String(value);
  const anyVisible = settings.some((s) => {
    const eq = s.visibleWhen!.equals;
    const equals = Array.isArray(eq) ? eq : [eq];
    return equals.includes(current);
  });
  if (!anyVisible) return null;
  return (
    <SettingsGroup name={name} description={description} settings={settings} />
  );
}

/**
 * Decides whether a group should be gated behind a shared `visibleWhen`
 * condition, and renders the appropriate component.
 */
function ConditionalSettingsGroup({
  name,
  description,
  settings
}: {
  name: string;
  description?: string;
  settings: IntegrationSetting[];
}) {
  const firstCondition = settings[0]?.visibleWhen;
  const sharesCondition =
    firstCondition !== undefined &&
    settings.every(
      (s) => s.visibleWhen && s.visibleWhen.field === firstCondition.field
    );

  if (sharesCondition) {
    return (
      <GatedSettingsGroup
        name={name}
        description={description}
        settings={settings}
        controlledField={firstCondition!.field}
      />
    );
  }

  return (
    <SettingsGroup name={name} description={description} settings={settings} />
  );
}

/**
 * Renders a group of related settings under a subtle section header.
 * Previously this was a collapsible, but every consumer always opened it
 * by default and never closed it, so the chrome was pure noise.
 */
function SettingsGroup({
  name,
  description,
  settings
}: {
  name: string;
  description?: string;
  settings: IntegrationSetting[];
}) {
  return (
    <div className="w-full border-t border-border pt-4">
      <div className="flex flex-col gap-1 pb-3">
        <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-foreground/70">
          {name}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <VStack spacing={4}>
        {settings.map((setting) => (
          <SettingField key={setting.name} setting={setting} />
        ))}
      </VStack>
    </div>
  );
}

interface IntegrationFormProps {
  metadata: Record<string, unknown>;
  installed: boolean;
  onClose: () => void;
  /** Dynamic options to merge into settings (e.g., fetched from external APIs) */
  dynamicOptions?: Record<
    string,
    Array<{ value: string; label: string; description?: string }>
  >;
}

export function IntegrationForm({
  installed,
  metadata,
  onClose,
  dynamicOptions = {}
}: IntegrationFormProps) {
  const permissions = usePermissions();
  const isDisabled = !permissions.can("update", "settings");
  const {
    company: { id: companyId }
  } = useUser();

  const { id: integrationId } = useParams();

  const integration = integrationId
    ? availableIntegrations.find((i) => i.id === integrationId)
    : undefined;

  // Extract connected organisation name from metadata (e.g. Xero tenant name)
  const connectedOrgName = (metadata?.credentials as Record<string, unknown>)
    ?.tenantName as string | undefined;

  // Group settings by their group property
  // Settings without a group appear first (ungrouped)
  // Also merges dynamic options into settings that have them
  const { ungroupedSettings, groupedSettings, groupNames, groupDescriptions } =
    useMemo(() => {
      if (!integration) {
        return {
          ungroupedSettings: [] as IntegrationSetting[],
          groupedSettings: new Map<string, IntegrationSetting[]>(),
          groupNames: [] as string[],
          groupDescriptions: new Map<string, string | undefined>()
        };
      }

      const ungrouped: IntegrationSetting[] = [];
      const grouped = new Map<string, IntegrationSetting[]>();

      for (const baseSetting of integration.settings) {
        // Merge dynamic options if available for this setting
        const setting: IntegrationSetting = dynamicOptions[baseSetting.name]
          ? {
              ...baseSetting,
              listOptions: dynamicOptions[baseSetting.name]
            }
          : (baseSetting as IntegrationSetting);

        if (!setting.group) {
          ungrouped.push(setting);
        } else {
          const existing = grouped.get(setting.group) ?? [];
          grouped.set(setting.group, [...existing, setting]);
        }
      }

      // Build group descriptions map from settingGroups
      const descriptions = new Map<string, string | undefined>();
      const settingGroups =
        (integration as { settingGroups?: IntegrationSettingGroup[] })
          .settingGroups ?? [];
      for (const group of settingGroups) {
        descriptions.set(group.name, group.description);
      }

      return {
        ungroupedSettings: ungrouped,
        groupedSettings: grouped,
        groupNames: [...grouped.keys()],
        groupDescriptions: descriptions
      };
    }, [integration, dynamicOptions]);

  const initialValues = useMemo(() => {
    if (!integration) return {};
    return integration.settings.reduce(
      (acc, setting) => {
        return {
          ...acc,
          [setting.name]: metadata[setting.name] ?? setting.value
        };
      },
      {} as Record<string, unknown>
    );
  }, [integration, metadata]);

  if (!integrationId) {
    throw new Error("Integration ID is required");
  }

  if (!integration) {
    toast.error("Integration not found");
    return null;
  }

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={integration.schema}
          method="post"
          action={path.to.integration(integration.id)}
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-card p-1.5">
                  <integration.logo className="h-full w-auto" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <Heading size="h3" className="truncate">
                      {integration.name}
                    </Heading>
                    {installed && <Badge variant="green">Installed</Badge>}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge variant="secondary">{integration.category}</Badge>
                    <span aria-hidden>•</span>
                    <span>Published by Carbon</span>
                  </div>
                </div>
              </div>
              {installed && connectedOrgName && (
                <div className="text-sm text-muted-foreground">
                  Connected to{" "}
                  <span className="font-medium text-foreground">
                    {connectedOrgName}
                  </span>
                </div>
              )}
            </div>
          </DrawerHeader>
          <DrawerBody>
            <ScrollArea className="h-[calc(100dvh-240px)] -mx-2 pb-8">
              <VStack spacing={4} className="px-2">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {integration.description}
                </p>

                {/* @ts-expect-error TS2339 */}
                {integration.setupInstructions && (
                  <div className="flex flex-col gap-2">
                    <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-foreground/70">
                      Setup instructions
                    </div>
                    {/* @ts-expect-error TS2339 */}
                    <integration.setupInstructions companyId={companyId} />
                  </div>
                )}

                {/* Ungrouped settings appear first */}
                {ungroupedSettings.length > 0 && (
                  <VStack spacing={4} className="w-full">
                    {ungroupedSettings.map((setting) => (
                      <SettingField key={setting.name} setting={setting} />
                    ))}
                  </VStack>
                )}

                {/* Grouped settings in flat sections */}
                {groupNames.map((groupName) => (
                  <ConditionalSettingsGroup
                    key={groupName}
                    name={groupName}
                    description={groupDescriptions.get(groupName)}
                    settings={groupedSettings.get(groupName) ?? []}
                  />
                ))}

                {installed &&
                  // @ts-expect-error TS2339 - TODO: fix type
                  integration.actions &&
                  // @ts-expect-error TS2339 - TODO: fix type
                  integration.actions.length > 0 && (
                    <div className="flex w-full flex-col gap-3 border-t border-border pt-4">
                      <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-foreground/70">
                        Actions
                      </div>
                      <VStack spacing={2} className="w-full">
                        {/* @ts-expect-error TS7006 */}
                        {integration.actions.map((action) => (
                          <IntegrationActionButton
                            key={action.id}
                            action={action}
                            isDisabled={isDisabled}
                          />
                        ))}
                      </VStack>
                    </div>
                  )}
              </VStack>
            </ScrollArea>
            <div className="mt-2">
              <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
                Carbon Manufacturing Systems does not endorse any third-party
                software.{" "}
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                >
                  Report integration
                </a>
                .
              </p>
            </div>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              {integration.settings.length > 0 ? (
                installed ? (
                  <Submit isDisabled={isDisabled}>Update</Submit>
                ) : (
                  <Submit isDisabled={isDisabled}>Install</Submit>
                )
              ) : null}

              <Button variant="solid" onClick={onClose}>
                Close
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
}
