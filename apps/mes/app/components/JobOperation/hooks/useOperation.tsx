import { useCarbon } from "@carbon/auth";
import {
  toast,
  useDisclosure,
  useInterval,
  useRealtimeChannel
} from "@carbon/react";
import type { TrackedEntityAttributes } from "@carbon/utils";
import {
  getLocalTimeZone,
  now,
  parseAbsolute,
  toZoned
} from "@internationalized/date";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRevalidator } from "react-router";
import { useUrlParams, useUser } from "~/hooks";
import type {
  JobMaterial,
  JobOperationParameter,
  JobOperationStep,
  OperationWithDetails,
  ProductionEvent,
  TrackedEntity
} from "~/services/types";
import { path } from "~/utils/path";

export function useOperation({
  operation,
  events,
  trackedEntities,
  pauseInterval,
  procedure
}: {
  operation: OperationWithDetails;
  events: ProductionEvent[];
  trackedEntities: TrackedEntity[];
  pauseInterval: boolean;
  procedure: Promise<{
    attributes: JobOperationStep[];
    parameters: JobOperationParameter[];
  }>;
}) {
  const [params] = useUrlParams();
  const trackedEntityParam = params.get("trackedEntityId");
  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { carbon, accessToken } = useCarbon();
  const user = useUser();

  const revalidator = useRevalidator();
  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const channelRef = useRef<RealtimeChannel | null>(null);

  const scrapModal = useDisclosure();
  const reworkModal = useDisclosure();
  const completeModal = useDisclosure();
  const finishModal = useDisclosure();
  const issueModal = useDisclosure();
  const serialModal = useDisclosure();

  // we do this to avoid re-rendering when the modal is open
  const isAnyModalOpen =
    pauseInterval ||
    scrapModal.isOpen ||
    reworkModal.isOpen ||
    completeModal.isOpen ||
    finishModal.isOpen ||
    issueModal.isOpen ||
    serialModal.isOpen;

  const [selectedMaterial, setSelectedMaterial] = useState<JobMaterial | null>(
    null
  );

  const [activeTab, setActiveTab] = useState("details");
  const [eventType, setEventType] = useState(() => {
    if (operation.setupDuration > 0) {
      return "Setup";
    }
    if (operation.machineDuration > 0) {
      return "Machine";
    }
    return "Labor";
  });

  const [operationState, setOperationState] = useState(operation);

  const [eventState, setEventState] = useState<ProductionEvent[]>(events);
  const productionEvents = useMemo(
    () => getCurrentProductionEvents(eventState),
    [eventState]
  );

  useEffect(() => {
    setEventState(events);
  }, [events]);

  useEffect(() => {
    setOperationState(operation);
  }, [operation]);

  useRealtimeChannel({
    topic: `job-operations:${operation.id}`,
    dependencies: [operation.jobId],
    setup(channel) {
      return channel
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "job",
            filter: `id=eq.${operation.jobId}`
          },
          (payload) => {
            if (payload.eventType === "UPDATE") {
              revalidator.revalidate();
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "productionEvent",
            filter: `jobOperationId=eq.${operation.id}`
          },
          (payload) => {
            switch (payload.eventType) {
              case "INSERT":
                const { new: inserted } = payload;
                setEventState((prevEvents) =>
                  upsertProductionEvent(prevEvents, inserted as ProductionEvent)
                );
                break;
              case "UPDATE":
                const { new: updated } = payload;

                setEventState((prevEvents) =>
                  upsertProductionEvent(prevEvents, updated as ProductionEvent)
                );
                break;
              case "DELETE":
                const { old: deleted } = payload;
                setEventState((prevEvents) =>
                  prevEvents.filter((event) => event.id !== deleted.id)
                );
                break;
              default:
                break;
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "jobOperation",
            filter: `id=eq.${operation.id}`
          },
          (payload) => {
            if (payload.eventType === "UPDATE") {
              const updated = payload.new;
              setOperationState((prev) => ({
                ...prev,
                ...updated,
                operationStatus: updated.status ?? prev.operationStatus
              }));
            } else if (payload.eventType === "DELETE") {
              toast.error("This operation has been deleted");
              window.location.href = path.to.operations;
            }
          }
        );
    }
  });

  const getProgress = useCallback(() => {
    const timeNow = now(getLocalTimeZone());
    return productionEvents.reduce(
      (acc, event) => {
        if (event.endTime && event.type) {
          acc[event.type.toLowerCase() as keyof typeof acc] +=
            getCompletedProductionEventDurationMs(event);
        } else if (event.startTime && event.type) {
          const startTime = toZoned(
            parseAbsolute(event.startTime, getLocalTimeZone()),
            getLocalTimeZone()
          );

          const difference = timeNow.compare(startTime);

          if (difference > 0) {
            acc[event.type.toLowerCase() as keyof typeof acc] += difference;
          }
        }
        return acc;
      },
      {
        setup: 0,
        labor: 0,
        machine: 0
      }
    );
  }, [productionEvents]);

  const [progress, setProgress] = useState<{
    setup: number;
    labor: number;
    machine: number;
  }>(getProgress);

  useEffect(() => {
    setProgress(getProgress());
  }, [getProgress]);

  const activeEvents = useMemo(() => {
    return {
      setupProductionEvent: productionEvents.find(
        (e) =>
          e.type === "Setup" && e.endTime === null && e.employeeId === user.id
      ),
      laborProductionEvent: productionEvents.find(
        (e) =>
          e.type === "Labor" && e.endTime === null && e.employeeId === user.id
      ),
      machineProductionEvent: productionEvents.find(
        (e) => e.type === "Machine" && e.endTime === null
      )
    };
  }, [productionEvents, user.id]);

  const active = useMemo(() => {
    return {
      setup: !!activeEvents.setupProductionEvent,
      labor: !!activeEvents.laborProductionEvent,
      machine: !!activeEvents.machineProductionEvent
    };
  }, [activeEvents]);

  useInterval(
    () => {
      setProgress(getProgress());
    },
    (active.setup || active.labor || active.machine) && !isAnyModalOpen
      ? 1000
      : null
  );

  const { operationId } = useParams();
  const [availableEntities, setAvailableEntities] = useState<TrackedEntity[]>(
    []
  );
  // show the serial selector with the remaining serial numbers for the operation
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (trackedEntityParam) return;
    const uncompletedEntities = trackedEntities.filter(
      (entity) =>
        !(
          `Operation ${operationId}` in
          ((entity.attributes as TrackedEntityAttributes) ?? {})
        )
    );
    if (uncompletedEntities.length > 0) serialModal.onOpen();
    setAvailableEntities(uncompletedEntities);
    // causes an infinite loop on navigation
  }, [trackedEntities, trackedEntityParam]);

  return {
    active,
    availableEntities,
    hasActiveEvents:
      progress.setup > 0 || progress.labor > 0 || progress.machine > 0,
    ...activeEvents,
    progress,
    productionEvents,
    operation: operationState,

    activeTab,
    eventType,
    scrapModal,
    reworkModal,
    completeModal,
    finishModal,
    issueModal,
    serialModal,
    isOverdue: operation.operationDueDate
      ? new Date(operation.operationDueDate) < new Date()
      : false,
    selectedMaterial,
    setSelectedMaterial,
    setActiveTab,
    setEventType
  };
}

function getCurrentProductionEvents(events: ProductionEvent[]) {
  const dedupedEvents = dedupeProductionEvents(events);
  const latestByTimer = new Map<string, ProductionEvent>();

  for (const event of dedupedEvents) {
    const key = getTimerIdentity(event);
    const latest = latestByTimer.get(key);

    if (!latest || compareProductionEventRecency(event, latest) > 0) {
      latestByTimer.set(key, event);
    }
  }

  return dedupedEvents.filter((event) => {
    if (event.endTime) return true;

    return latestByTimer.get(getTimerIdentity(event))?.id === event.id;
  });
}

function upsertProductionEvent(
  events: ProductionEvent[],
  incomingEvent: ProductionEvent
) {
  const eventById = new Map(events.map((event) => [event.id, event]));
  const existingEvent = eventById.get(incomingEvent.id);

  eventById.set(incomingEvent.id, {
    ...existingEvent,
    ...incomingEvent
  });

  return Array.from(eventById.values());
}

function dedupeProductionEvents(events: ProductionEvent[]) {
  return Array.from(
    events
      .reduce((eventById, event) => {
        const existingEvent = eventById.get(event.id);
        eventById.set(event.id, {
          ...existingEvent,
          ...event
        });

        return eventById;
      }, new Map<string, ProductionEvent>())
      .values()
  );
}

function getTimerIdentity(event: ProductionEvent) {
  if (event.type === "Machine") {
    return `${event.type}:${event.workCenterId ?? "operation"}`;
  }

  return `${event.type ?? "Time"}:${event.employeeId ?? "employee"}`;
}

function compareProductionEventRecency(
  event: ProductionEvent,
  otherEvent: ProductionEvent
) {
  const startDifference =
    getEventTime(event.startTime) - getEventTime(otherEvent.startTime);
  if (startDifference !== 0) return startDifference;

  const createdDifference =
    getEventTime(event.createdAt) - getEventTime(otherEvent.createdAt);
  if (createdDifference !== 0) return createdDifference;

  return event.id.localeCompare(otherEvent.id);
}

function getCompletedProductionEventDurationMs(event: ProductionEvent) {
  if (event.duration && event.duration > 0) return event.duration * 1000;
  if (!event.endTime) return 0;

  const start = getEventTime(event.startTime);
  const end = getEventTime(event.endTime);

  return Math.max(0, end - start);
}

function getEventTime(date: string | null | undefined) {
  const time = new Date(date ?? "").getTime();
  return Number.isNaN(time) ? 0 : time;
}
