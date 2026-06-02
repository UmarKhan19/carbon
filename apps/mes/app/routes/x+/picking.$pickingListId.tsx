import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Heading,
  HStack,
  SidebarTrigger,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { userContext } from "~/context";
import {
  getPickingListForExecution,
  updatePickingListStatus
} from "~/services/picking.service";
import { path } from "~/utils/path";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});
  const effectiveUserId = context.get(userContext)?.effectiveUserId ?? userId;
  const pickingListId = params.pickingListId!;

  const result = await getPickingListForExecution(client, pickingListId);

  if (result.error || !result.data) {
    throw new Response("Picking list not found", { status: 404 });
  }

  // Auto-transition Draft to In Progress
  if (result.data.status === "Draft") {
    await updatePickingListStatus(
      client,
      pickingListId,
      "In Progress",
      effectiveUserId
    );
    result.data.status = "In Progress";
  }

  return {
    pickingList: result.data
  };
}

type Line = NonNullable<
  Awaited<ReturnType<typeof getPickingListForExecution>>["data"]
>["lines"][number];

interface GroupedKit {
  key: string;
  label: string;
  lines: Line[];
}

export default function PickingExecutionRoute() {
  const { t } = useLingui();
  const { pickingList } = useLoaderData<typeof loader>();

  const groupedKits = useMemo(() => {
    const groups = new Map<string, GroupedKit>();

    for (const line of pickingList.lines ?? []) {
      const op = line.jobOperation;
      const key = line.jobOperationId ?? "ungrouped";
      const label = op
        ? `${(line.job as any)?.jobId ?? ""} - Op ${op.order}: ${(op.process as any)?.name ?? ""} (${(op.workCenter as any)?.name ?? ""})`
        : t`Ungrouped`;

      if (!groups.has(key)) {
        groups.set(key, { key, label, lines: [] });
      }
      groups.get(key)!.lines.push(line);
    }

    return Array.from(groups.values());
  }, [pickingList.lines, t]);

  return (
    <div className="flex flex-col flex-1">
      <header className="sticky top-0 z-10 flex h-[var(--header-height)] shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b bg-background">
        <div className="flex items-center gap-2 px-2">
          <SidebarTrigger />
          <Heading size="h4">{pickingList.pickingListId}</Heading>
          <Badge
            variant={
              pickingList.status === "Completed"
                ? "default"
                : pickingList.status === "In Progress"
                  ? "default"
                  : "secondary"
            }
          >
            {pickingList.status}
          </Badge>
        </div>
      </header>

      <main className="h-[calc(100dvh-var(--header-height))] w-full overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent p-4">
        <VStack className="gap-4">
          {groupedKits.map((kit) => (
            <KitSection
              key={kit.key}
              kit={kit}
              pickingListId={pickingList.id}
            />
          ))}
        </VStack>
      </main>
    </div>
  );
}

function KitSection({
  kit,
  pickingListId
}: {
  kit: GroupedKit;
  pickingListId: string;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none">
            <HStack className="justify-between">
              <HStack>
                {open ? (
                  <LuChevronDown className="h-4 w-4" />
                ) : (
                  <LuChevronRight className="h-4 w-4" />
                )}
                <CardTitle className="text-sm">{kit.label}</CardTitle>
              </HStack>
              <span className="text-xs text-muted-foreground">
                {
                  kit.lines.filter(
                    (l) =>
                      l.status === "Picked" ||
                      l.status === "Short" ||
                      l.status === "Cancelled"
                  ).length
                }
                /{kit.lines.length}
              </span>
            </HStack>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            <VStack className="gap-3">
              {kit.lines.map((line) => (
                <PickLineCard
                  key={line.id}
                  line={line}
                  pickingListId={pickingListId}
                />
              ))}
            </VStack>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function PickLineCard({
  line,
  pickingListId
}: {
  line: Line;
  pickingListId: string;
}) {
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";
  const isResolved =
    line.status === "Picked" ||
    line.status === "Short" ||
    line.status === "Cancelled";

  const item = line.item as { name: string; readableId: string } | null;
  const storageUnit = line.storageUnit as { name: string } | null;
  const quantityToPick = Number(line.quantityToPick ?? 0);

  const handleConfirm = () => {
    const formData = new FormData();
    formData.append("pickingListLineId", line.id);
    formData.append("quantityPicked", String(quantityToPick));

    if (line.trackedEntities?.length) {
      const trackedEntities = line.trackedEntities.map((te: any) => ({
        trackedEntityId: te.trackedEntityId,
        quantityPicked: Number(te.trackedEntity?.quantity ?? 0)
      }));
      formData.append("trackedEntities", JSON.stringify(trackedEntities));
    }

    fetcher.submit(formData, {
      method: "post",
      action: path.to.pickingConfirm(pickingListId)
    });
  };

  const handleShort = () => {
    const formData = new FormData();
    formData.append("pickingListLineId", line.id);
    formData.append("quantityPicked", "0");

    fetcher.submit(formData, {
      method: "post",
      action: path.to.pickingConfirm(pickingListId)
    });
  };

  return (
    <div
      className={`border rounded-md p-3 ${isResolved ? "opacity-60 bg-muted" : "bg-card"}`}
    >
      <HStack className="justify-between items-start">
        <VStack className="gap-1 flex-1">
          <HStack className="gap-2">
            <span className="font-medium text-sm">{item?.readableId}</span>
            <span className="text-sm text-muted-foreground">{item?.name}</span>
          </HStack>
          <HStack className="gap-4 text-xs text-muted-foreground">
            <span>
              <Trans>Qty</Trans>: {quantityToPick}
            </span>
            {storageUnit && (
              <span>
                <Trans>From</Trans>: {storageUnit.name}
              </span>
            )}
          </HStack>
          {line.trackedEntities && line.trackedEntities.length > 0 && (
            <div className="mt-1">
              {line.trackedEntities.map((te: any) => (
                <span
                  key={te.id}
                  className="text-xs bg-muted px-1.5 py-0.5 rounded mr-1"
                >
                  {te.trackedEntity?.readableId} ({te.trackedEntity?.quantity})
                </span>
              ))}
            </div>
          )}
        </VStack>
        <HStack className="gap-2 shrink-0">
          {isResolved ? (
            <Badge
              variant={line.status === "Picked" ? "default" : "destructive"}
            >
              {line.status}
            </Badge>
          ) : (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleShort}
                disabled={isSubmitting}
              >
                <Trans>Short</Trans>
              </Button>
              <Button size="sm" onClick={handleConfirm} disabled={isSubmitting}>
                <Trans>Confirm</Trans>
              </Button>
            </>
          )}
        </HStack>
      </HStack>
    </div>
  );
}
