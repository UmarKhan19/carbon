import { Badge, HStack, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useParams } from "react-router";
import { EmployeeAvatar } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useDateFormatter, useRouteData } from "~/hooks";
import type { ChangeOrderDetail } from "~/modules/items";
import type { ListItem } from "~/types";
import { path } from "~/utils/path";

// Read-only; editing basic fields happens on the details form (ChangeOrderForm).
const ChangeOrderProperties = () => {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { formatDate } = useDateFormatter();

  const routeData = useRouteData<{
    changeOrder: ChangeOrderDetail;
    changeOrderTypes: ListItem[];
  }>(path.to.changeOrder(id));

  const changeOrder = routeData?.changeOrder;
  const category = routeData?.changeOrderTypes?.find(
    (t) => t.id === changeOrder?.changeOrderTypeId
  )?.name;

  const Field = ({
    label,
    children
  }: {
    label: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <VStack spacing={1}>
      <h3 className="text-xs text-muted-foreground">{label}</h3>
      <div className="text-sm">{children}</div>
    </VStack>
  );

  return (
    <VStack
      spacing={4}
      className="w-96 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <h3 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
        <Trans>Properties</Trans>
      </h3>

      <Field label={<Trans>Name</Trans>}>{changeOrder?.name}</Field>

      <Field label={<Trans>Assignee</Trans>}>
        {changeOrder?.assignee ? (
          <EmployeeAvatar employeeId={changeOrder.assignee} size="xxs" />
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Field>

      <Field label={<Trans>Type</Trans>}>
        <Enumerable value={changeOrder?.type ?? null} />
      </Field>

      <Field label={<Trans>Category</Trans>}>
        <Enumerable value={category ?? null} />
      </Field>

      <Field label={<Trans>Approval Type</Trans>}>
        <Enumerable value={changeOrder?.approvalType ?? null} />
      </Field>

      <Field label={<Trans>Priority</Trans>}>
        {changeOrder?.priority ?? "—"}
      </Field>

      <Field label={<Trans>Open Date</Trans>}>
        {formatDate(changeOrder?.openDate)}
      </Field>

      <Field label={<Trans>Due Date</Trans>}>
        {formatDate(changeOrder?.dueDate)}
      </Field>

      <Field label={<Trans>Effective Date</Trans>}>
        {formatDate(changeOrder?.effectiveDate)}
      </Field>

      <Field label={<Trans>Created By</Trans>}>
        <EmployeeAvatar employeeId={changeOrder?.createdBy!} size="xxs" />
      </Field>

      {changeOrder?.sourceType === "onshape" && (
        <Field label={<Trans>Source</Trans>}>
          <HStack spacing={2} className="items-center">
            <Badge variant="outline">OnShape</Badge>
            {changeOrder.sourceId && (
              <span className="text-xs text-muted-foreground">
                {changeOrder.sourceId}
              </span>
            )}
          </HStack>
        </Field>
      )}
    </VStack>
  );
};

export default ChangeOrderProperties;
