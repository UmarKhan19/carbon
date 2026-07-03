import type { Json } from "@carbon/database";
import { OnshapeLogo } from "@carbon/ee";
import {
  DatePicker,
  InputControlled,
  Select,
  ValidatedForm
} from "@carbon/form";
import {
  Badge,
  Button,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useCallback, useEffect } from "react";
import { LuCopy, LuLink, LuShieldAlert } from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { z } from "zod";
import {
  Assignee,
  EmployeeAvatar,
  useOptimisticAssignment
} from "~/components";
import { Tags } from "~/components/Form";
import CustomFormInlineFields from "~/components/Form/CustomFormInlineFields";
import { usePermissions, useRouteData } from "~/hooks";
import type { ChangeOrderDetail } from "~/modules/items";
import {
  changeOrderApprovalType,
  changeOrderPriority,
  changeOrderType,
  isChangeOrderLocked
} from "~/modules/items";
import type { action } from "~/routes/x+/items+/update";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";

// Change orders are spawned from a growing set of upstream systems. Describe
// each source as data (icon, label, optional back-link, optional detail line)
// rather than a branch per type — an unknown sourceType falls back to a plain
// badge. Add a new integration by adding a row here.
const CHANGE_ORDER_SOURCES: Record<
  string,
  {
    icon: ReactNode;
    label: ReactNode;
    href?: (sourceId: string) => string;
    detail?: (sourceId: string) => ReactNode;
  }
> = {
  onshape: {
    icon: <OnshapeLogo className="h-4 w-auto" />,
    label: <Trans>OnShape</Trans>,
    detail: (sourceId) => <Trans>Release {sourceId}</Trans>
  },
  nonConformance: {
    icon: <LuShieldAlert className="h-4 w-4" />,
    label: <Trans>Quality Issue</Trans>,
    href: (sourceId) => path.to.issue(sourceId)
  }
};

const ChangeOrderSource = ({
  sourceType,
  sourceId
}: {
  sourceType: string;
  sourceId: string | null;
}) => {
  const descriptor = CHANGE_ORDER_SOURCES[sourceType];
  const badge = (
    <Badge variant="outline">{descriptor?.label ?? sourceType}</Badge>
  );

  return (
    <VStack spacing={2}>
      <h3 className="text-xs text-muted-foreground">
        <Trans>Source</Trans>
      </h3>
      <HStack spacing={2} className="items-center">
        {descriptor?.icon}
        {descriptor?.href && sourceId ? (
          <Link to={descriptor.href(sourceId)}>{badge}</Link>
        ) : (
          badge
        )}
      </HStack>
      {descriptor?.detail && sourceId && (
        <span className="text-xs text-muted-foreground">
          {descriptor.detail(sourceId)}
        </span>
      )}
    </VStack>
  );
};

const ChangeOrderProperties = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { t } = useLingui();
  const permissions = usePermissions();

  const routeData = useRouteData<{
    changeOrder: ChangeOrderDetail;
    tags: { name: string }[];
  }>(path.to.changeOrder(id));

  const optimisticAssignment = useOptimisticAssignment({
    id: id,
    table: "changeOrder"
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.changeOrder?.assignee;

  const isStarted = routeData?.changeOrder?.status !== "Draft";
  const isLocked = isChangeOrderLocked(routeData?.changeOrder?.status);

  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error.message);
    }
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdate = useCallback(
    (
      field:
        | "name"
        | "description"
        | "type"
        | "approvalType"
        | "priority"
        | "approvalRequirements"
        | "openDate"
        | "dueDate"
        | "effectiveDate"
        | "assignee",
      value: string | null
    ) => {
      const formData = new FormData();

      formData.append("ids", id);
      formData.append("field", field);

      formData.append("value", value?.toString() ?? "");
      fetcher.submit(formData, {
        method: "post",
        action: path.to.bulkUpdateChangeOrder
      });
    },

    [id]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateTags = useCallback(
    (value: string[]) => {
      const formData = new FormData();

      formData.append("ids", id);
      formData.append("table", "changeOrder");
      value.forEach((v) => {
        formData.append("value", v);
      });

      fetcher.submit(formData, {
        method: "post",
        action: path.to.tags
      });
    },

    [id]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateCustomFields = useCallback(
    (value: string) => {
      const formData = new FormData();

      formData.append("ids", id);
      formData.append("table", "changeOrder");
      formData.append("value", value);

      fetcher.submit(formData, {
        method: "post",
        action: path.to.customFields
      });
    },

    [id]
  );

  const disableStructureUpdate =
    !permissions.can("delete", "production") || isStarted || isLocked;

  return (
    <VStack
      spacing={4}
      className="w-96 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={2}>
        <HStack className="w-full justify-between">
          <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
            <Trans>Properties</Trans>
          </h3>
          <HStack spacing={1}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label={t`Link`}
                  size="sm"
                  className="p-1"
                  onClick={() =>
                    copyToClipboard(
                      window.location.origin + path.to.changeOrder(id)
                    )
                  }
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy link to change order</Trans>
                </span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <VStack spacing={1}>
          <HStack spacing={1} className="group items-center">
            <span className="text-sm tracking-tight">
              {routeData?.changeOrder?.changeOrderId}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label={t`Copy change order number`}
                  size="sm"
                  className="p-1 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() =>
                    copyToClipboard(routeData?.changeOrder?.changeOrderId ?? "")
                  }
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>
                  <Trans>Copy change order number</Trans>
                </span>
              </TooltipContent>
            </Tooltip>
          </HStack>
          <h3 className="text-xs text-muted-foreground">
            <Trans>Name</Trans>
          </h3>
          <ValidatedForm
            defaultValues={{
              name: routeData?.changeOrder?.name ?? undefined
            }}
            validator={z.object({
              name: z.string()
            })}
            className="w-full"
          >
            <span className="text-xs text-muted-foreground">
              <InputControlled
                label=""
                name="name"
                size="sm"
                inline
                isReadOnly={isLocked}
                value={routeData?.changeOrder?.name ?? ""}
                onBlur={(e) => {
                  onUpdate("name", e.target.value ?? null);
                }}
                className="text-muted-foreground"
              />
            </span>
          </ValidatedForm>
        </VStack>
      </VStack>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">
          <Trans>Assignee</Trans>
        </h3>
        <Assignee
          id={id}
          table="changeOrder"
          size="sm"
          value={assignee ?? ""}
          isReadOnly={!permissions.can("update", "production")}
        />
      </VStack>

      <ValidatedForm
        defaultValues={{
          type: routeData?.changeOrder?.type ?? ""
        }}
        validator={z.object({
          type: z.string().optional()
        })}
        className="w-full"
      >
        <Select
          options={changeOrderType.map((type) => ({
            value: type,
            label: type
          }))}
          isReadOnly={disableStructureUpdate}
          label={t`Type`}
          name="type"
          inline={(value, options) => {
            return <span>{value}</span>;
          }}
          onChange={(value) => {
            if (value) {
              onUpdate("type", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          approvalType: routeData?.changeOrder?.approvalType ?? ""
        }}
        validator={z.object({
          approvalType: z.string().optional()
        })}
        className="w-full"
      >
        <Select
          options={changeOrderApprovalType.map((approvalType) => ({
            value: approvalType,
            label: approvalType
          }))}
          isReadOnly={disableStructureUpdate}
          label={t`Approval Type`}
          name="approvalType"
          inline={(value, options) => {
            return <span>{value}</span>;
          }}
          onChange={(value) => {
            if (value) {
              onUpdate("approvalType", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          priority: routeData?.changeOrder?.priority ?? ""
        }}
        validator={z.object({
          priority: z.string().optional()
        })}
        className="w-full"
      >
        <Select
          options={changeOrderPriority.map((priority) => ({
            value: priority,
            label: priority
          }))}
          isReadOnly={disableStructureUpdate}
          label={t`Priority`}
          name="priority"
          inline={(value, options) => {
            return <span>{value}</span>;
          }}
          onChange={(value) => {
            if (value) {
              onUpdate("priority", value.value);
            }
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          openDate: routeData?.changeOrder?.openDate ?? ""
        }}
        validator={z.object({
          openDate: z.string().min(1, { message: "Open date is required" })
        })}
        className="w-full"
      >
        <DatePicker
          name="openDate"
          label={t`Open Date`}
          inline
          isDisabled={!permissions.can("update", "production") || isLocked}
          onChange={(date) => {
            onUpdate("openDate", date);
          }}
        />
      </ValidatedForm>

      <VStack spacing={2}>
        <h3 className="text-xs text-muted-foreground">
          <Trans>Created By</Trans>
        </h3>
        <EmployeeAvatar
          employeeId={routeData?.changeOrder?.createdBy!}
          size="xxs"
        />
      </VStack>

      {routeData?.changeOrder?.sourceType && (
        <ChangeOrderSource
          sourceType={routeData.changeOrder.sourceType}
          sourceId={routeData.changeOrder.sourceId}
        />
      )}

      <ValidatedForm
        defaultValues={{
          dueDate: routeData?.changeOrder?.dueDate ?? ""
        }}
        validator={z.object({
          dueDate: z.string().min(1, { message: "Due date is required" })
        })}
        className="w-full"
      >
        <DatePicker
          name="dueDate"
          label={t`Due Date`}
          inline
          isDisabled={!permissions.can("update", "production") || isLocked}
          onChange={(date) => {
            onUpdate("dueDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          effectiveDate: routeData?.changeOrder?.effectiveDate ?? ""
        }}
        validator={z.object({
          effectiveDate: z
            .string()
            .min(1, { message: "Effective date is required" })
        })}
        className="w-full"
      >
        <DatePicker
          name="effectiveDate"
          label={t`Effective Date`}
          inline
          isDisabled={!permissions.can("update", "production") || isLocked}
          onChange={(date) => {
            onUpdate("effectiveDate", date);
          }}
        />
      </ValidatedForm>

      <ValidatedForm
        defaultValues={{
          tags: routeData?.changeOrder?.tags ?? []
        }}
        validator={z.object({
          tags: z.array(z.string()).optional()
        })}
        className="w-full"
      >
        <Tags
          availableTags={routeData?.tags ?? []}
          label={t`Tags`}
          name="tags"
          table="changeOrder"
          inline
          onChange={onUpdateTags}
        />
      </ValidatedForm>

      <CustomFormInlineFields
        customFields={
          (routeData?.changeOrder?.customFields ?? {}) as Record<string, Json>
        }
        table="changeOrder"
        tags={routeData?.changeOrder?.tags ?? []}
        onUpdate={onUpdateCustomFields}
      />
    </VStack>
  );
};

export default ChangeOrderProperties;
