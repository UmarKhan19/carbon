import { calculateDurationHours } from "./duration-calculator.ts";
import type { MasterDataProvider } from "./master-data-provider.ts";
import {
  isEligibleOperator,
  type QualifiedEmployee,
} from "./operator-eligibility.ts";
import {
  allocateOperation,
  isConflict,
  type OperatorPool,
  type ReservationInterval,
  type ResourceCapacityData,
} from "./slot-allocator.ts";
import type {
  JobOperationDependency,
  PlannedReservation,
  ScheduledOperation,
  WorkCenterLoad,
  WorkCenterSelection,
} from "./types.ts";

export type AbilityRequirement = {
  abilityId: string;
  abilityName: string;
  minimumProficiency: number | null;
};

export {
  isEligibleOperator,
  type QualifiedEmployee,
} from "./operator-eligibility.ts";

/**
 * Preloaded finite-capacity data, built by the engine in initialize().
 * Reservation arrays are mutated in-run as operations are placed so later
 * operations see earlier placements.
 */
export type FiniteSchedulingContext = {
  capacityByWorkCenter: Map<string, ResourceCapacityData>;
  requiredAbilitiesByOperation: Map<string, AbilityRequirement[]>;
  processAbilitiesByProcess: Map<string, AbilityRequirement[]>;
  employeesByAbility: Map<string, QualifiedEmployee[]>;
  poolReservationsByAbility: Map<string, ReservationInterval[]>;
  abilityNamesById: Map<string, string>;
  dependencies: JobOperationDependency[];
  now: Date;
  horizonDays: number;
  /**
   * When true (reschedule mode), an operation that already has a work center
   * keeps it — only timing/conflicts are recomputed. Work centers are only
   * (re)selected at initial scheduling, or manually on the operations board.
   */
  stickyWorkCenters: boolean;
};

/**
 * Work Center Selector
 * Handles work center selection based on load balancing
 */
export class WorkCenterSelector {
  private provider: MasterDataProvider;
  private locationId: string;
  private workCentersByProcess: Map<string, string[]> = new Map();
  private activeWorkCenters: Set<string> = new Set();
  // Track in-memory load from operations assigned in current scheduling run
  private inMemoryLoadByWorkCenter: Map<string, number> = new Map();
  // Finite-capacity context (null => pure legacy load balancing)
  private finiteContext: FiniteSchedulingContext | null = null;
  private plannedReservations: PlannedReservation[] = [];

  constructor(provider: MasterDataProvider, locationId: string) {
    this.provider = provider;
    this.locationId = locationId;
  }

  setFiniteContext(context: FiniteSchedulingContext): void {
    this.finiteContext = context;
  }

  getPlannedReservations(): PlannedReservation[] {
    return this.plannedReservations;
  }

  /** Candidate work centers across a set of processes (for capacity preload). */
  getAllCandidateWorkCenterIds(processIds: (string | null)[]): string[] {
    const ids = new Set<string>();
    for (const processId of processIds) {
      if (!processId) continue;
      for (const wcId of this.getWorkCentersForProcess(processId)) {
        ids.add(wcId);
      }
    }
    return Array.from(ids);
  }

  /**
   * Add load for an operation assigned in memory (not yet persisted)
   */
  addInMemoryLoad(workCenterId: string, hours: number): void {
    const currentLoad = this.inMemoryLoadByWorkCenter.get(workCenterId) ?? 0;
    this.inMemoryLoadByWorkCenter.set(workCenterId, currentLoad + hours);
  }

  /**
   * Get total in-memory load for a work center
   */
  getInMemoryLoad(workCenterId: string): number {
    return this.inMemoryLoadByWorkCenter.get(workCenterId) ?? 0;
  }

  /**
   * Reset in-memory load tracking (call before a new scheduling run)
   */
  resetInMemoryLoad(): void {
    this.inMemoryLoadByWorkCenter.clear();
  }

  /**
   * Initialize work center data
   */
  async initialize(): Promise<void> {
    // Get processes and their work centers
    const processes = await this.provider.getProcessesWithWorkCenters();

    // Get active work centers at this location
    const workCenters = await this.provider.getActiveWorkCenters(
      this.locationId
    );

    // Build set of active work center IDs
    for (const wc of workCenters) {
      if (wc.id) {
        this.activeWorkCenters.add(wc.id);
      }
    }

    // Build process to work centers map (only include active work centers at this location)
    for (const process of processes) {
      if (process.workCenters && process.id) {
        const validWorkCenters = process.workCenters.filter((wcId) =>
          this.activeWorkCenters.has(wcId)
        );
        this.workCentersByProcess.set(process.id, validWorkCenters);
      }
    }
  }

  /**
   * Get work centers that support a given process
   */
  getWorkCentersForProcess(processId: string): string[] {
    return this.workCentersByProcess.get(processId) ?? [];
  }

  /**
   * Check if a work center is valid (exists and is active at this location)
   */
  isValidWorkCenter(workCenterId: string): boolean {
    return this.activeWorkCenters.has(workCenterId);
  }

  /**
   * Calculate total load (in hours) on a work center up to a given date
   */
  async calculateLoadBeforeDate(
    workCenterId: string,
    beforeDate: string
  ): Promise<number> {
    const operations = await this.provider.getWorkCenterLoadOperations(
      workCenterId,
      beforeDate
    );

    let totalHours = 0;
    for (const op of operations) {
      totalHours += calculateDurationHours({
        jobId: "", // Not needed for duration calculation
        processId: null,
        setupTime: op.setupTime ?? undefined,
        setupUnit: op.setupUnit ?? undefined,
        laborTime: op.laborTime ?? undefined,
        laborUnit: op.laborUnit ?? undefined,
        machineTime: op.machineTime ?? undefined,
        machineUnit: op.machineUnit ?? undefined,
        operationQuantity: op.operationQuantity ?? undefined,
      });
    }

    return totalHours;
  }

  /**
   * Get load information for all work centers supporting a process
   */
  async getLoadForProcessWorkCenters(
    processId: string,
    beforeDate: string
  ): Promise<WorkCenterLoad[]> {
    const workCenters = this.getWorkCentersForProcess(processId);
    const loads: WorkCenterLoad[] = [];

    for (const wcId of workCenters) {
      const operations = await this.provider.getWorkCenterLoadOperations(
        wcId,
        beforeDate
      );

      let totalHours = 0;
      for (const op of operations) {
        totalHours += calculateDurationHours({
          jobId: "", // Not needed for duration calculation
          processId: null,
          setupTime: op.setupTime ?? undefined,
          setupUnit: op.setupUnit ?? undefined,
          laborTime: op.laborTime ?? undefined,
          laborUnit: op.laborUnit ?? undefined,
          machineTime: op.machineTime ?? undefined,
          machineUnit: op.machineUnit ?? undefined,
          operationQuantity: op.operationQuantity ?? undefined,
        });
      }

      loads.push({
        workCenterId: wcId,
        totalHours,
        operationCount: operations.length,
      });
    }

    return loads;
  }

  /**
   * Select the optimal work center for an operation based on load balancing
   * Selects the work center with the least load before the operation's start date
   * Includes both database load and in-memory load from current scheduling run
   */
  async selectWorkCenter(
    processId: string | null,
    scheduledStartDate: string | null
  ): Promise<WorkCenterSelection> {
    if (!processId) {
      return {
        workCenterId: null,
        priority: 0,
        error: "No process ID provided",
      };
    }

    const workCenters = this.getWorkCentersForProcess(processId);

    if (workCenters.length === 0) {
      return {
        workCenterId: null,
        priority: 0,
        error: `No work centers found for process ${processId}`,
      };
    }

    // Use today if no start date
    const beforeDate = scheduledStartDate || new Date().toISOString().split("T")[0];

    let selectedWorkCenter: string | null = null;
    let lowestLoad = Infinity;

    for (const wcId of workCenters) {
      // Get load from database (other jobs)
      const dbLoad = await this.calculateLoadBeforeDate(wcId, beforeDate);
      // Add in-memory load from current scheduling run
      const inMemoryLoad = this.getInMemoryLoad(wcId);
      const totalLoad = dbLoad + inMemoryLoad;

      if (totalLoad < lowestLoad) {
        lowestLoad = totalLoad;
        selectedWorkCenter = wcId;
      }
    }

    if (!selectedWorkCenter) {
      return {
        workCenterId: null,
        priority: 0,
        error: "No work center selected after evaluation",
      };
    }

    return {
      workCenterId: selectedWorkCenter,
      priority: 0, // Priority will be calculated separately
      load: lowestLoad,
    };
  }

  /**
   * Select work centers for multiple operations
   * Re-evaluates all work center assignments based on scheduled dates
   * Tracks in-memory load to ensure proper load balancing within same scheduling run
   */
  async selectWorkCentersForOperations(
    operations: ScheduledOperation[]
  ): Promise<Map<string, WorkCenterSelection>> {
    if (this.finiteContext) {
      return this.selectWithFiniteCapacity(operations);
    }

    const selections = new Map<string, WorkCenterSelection>();

    // Reset in-memory load tracking for this scheduling run
    this.resetInMemoryLoad();

    // Sort by start date to process in order
    const sorted = [...operations].sort((a, b) => {
      if (!a.startDate && !b.startDate) return 0;
      if (!a.startDate) return 1;
      if (!b.startDate) return -1;
      return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    });

    for (const op of sorted) {
      // Skip outside operations (they don't need work center assignment)
      if (op.operationType === "Outside") {
        continue;
      }

      const selection = await this.selectWorkCenter(
        op.processId,
        op.startDate
      );
      selections.set(op.id, selection);

      // Track this operation's load in memory for subsequent selections
      if (selection.workCenterId) {
        const opDuration = op.durationHours ?? calculateDurationHours(op);
        this.addInMemoryLoad(selection.workCenterId, opDuration);
      }
    }

    return selections;
  }

  /**
   * Finite/DRC selection: for each operation, walk every candidate work
   * center's calendar to the first interval where a machine slot AND a
   * qualified operator are simultaneously free; pick the candidate with the
   * earliest finish (tie → least reserved time). Infinite work centers keep
   * the legacy least-loaded behavior. Conflicts surface on the selection,
   * never fail hard.
   */
  private async selectWithFiniteCapacity(
    operations: ScheduledOperation[]
  ): Promise<Map<string, WorkCenterSelection>> {
    const ctx = this.finiteContext!;
    const selections = new Map<string, WorkCenterSelection>();
    this.resetInMemoryLoad();
    this.plannedReservations = [];

    const depsByOperation = new Map<string, string[]>();
    for (const d of ctx.dependencies) {
      const list = depsByOperation.get(d.operationId) ?? [];
      list.push(d.dependsOnId);
      depsByOperation.set(d.operationId, list);
    }

    const placedEndByOperation = new Map<string, Date>();

    // Sort by start date so DAG order is approximated and in-run reservations
    // from predecessors are visible to successors
    const sorted = [...operations].sort((a, b) => {
      if (!a.startDate && !b.startDate) return 0;
      if (!a.startDate) return 1;
      if (!b.startDate) return -1;
      return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    });

    for (const op of sorted) {
      if (op.operationType === "Outside") {
        continue;
      }

      // Manually scheduled operations keep their pinned dates and work
      // center; reserve their existing window so their capacity still counts
      if (op.manuallyScheduled) {
        if (op.workCenterId && op.startDate && op.dueDate) {
          const startAt = new Date(op.startDate);
          const endAt = new Date(
            new Date(op.dueDate).getTime() + 24 * 3_600_000
          );
          const capacity = ctx.capacityByWorkCenter.get(op.workCenterId);
          if (capacity && endAt.getTime() > startAt.getTime()) {
            capacity.reservations.push({ startAt, endAt });
            this.plannedReservations.push({
              resourceKind: "WorkCenter",
              resourceId: op.workCenterId,
              operationId: op.id,
              startAt,
              endAt,
            });
            placedEndByOperation.set(op.id, endAt);
          }
        }
        selections.set(op.id, {
          workCenterId: op.workCenterId ?? null,
          priority: 0,
        });
        continue;
      }

      if (!op.processId) {
        selections.set(op.id, {
          workCenterId: null,
          priority: 0,
          error: "No process ID provided",
        });
        continue;
      }

      // Sticky work centers: on reschedule, an already-assigned operation
      // stays on its machine (setups/fixtures/operators live there) — the
      // replan only refreshes its timing and conflicts. Falls back to full
      // process candidates when the assigned work center has no capacity
      // data (e.g. it was deactivated since assignment).
      const candidates =
        ctx.stickyWorkCenters &&
        op.workCenterId &&
        ctx.capacityByWorkCenter.has(op.workCenterId)
          ? [op.workCenterId]
          : this.getWorkCentersForProcess(op.processId);
      if (candidates.length === 0) {
        selections.set(op.id, {
          workCenterId: null,
          priority: 0,
          error: `No work centers found for process ${op.processId}`,
        });
        continue;
      }

      // Earliest feasible start: DAG-computed start date, never in the past,
      // never before an in-run predecessor placement
      let earliestMs = ctx.now.getTime();
      if (op.startDate) {
        earliestMs = Math.max(earliestMs, new Date(op.startDate).getTime());
      }
      for (const depId of depsByOperation.get(op.id) ?? []) {
        const depEnd = placedEndByOperation.get(depId);
        if (depEnd) {
          earliestMs = Math.max(earliestMs, depEnd.getTime());
        }
      }
      const earliestStart = new Date(earliestMs);
      const horizonEnd = new Date(
        earliestMs + ctx.horizonDays * 24 * 3_600_000
      );

      // Operation-level requirements, falling back to process-level defaults.
      // The per-work-center requiredAbilityId fallback applies per candidate.
      const opRequirements =
        ctx.requiredAbilitiesByOperation.get(op.id) ??
        ctx.processAbilitiesByProcess.get(op.processId) ??
        null;

      const durationBase =
        op.durationHours ??
        calculateDurationHours({ ...op, priority: op.priority ?? undefined });

      let bestFinite: {
        wcId: string;
        slot: { start: Date; end: Date };
        reservedMs: number;
        capacity: ResourceCapacityData;
        requirements: AbilityRequirement[];
      } | null = null;
      let bestInfinite: { wcId: string; load: number } | null = null;
      let firstConflict: string | null = null;

      for (const wcId of candidates) {
        const capacity = ctx.capacityByWorkCenter.get(wcId);
        if (!capacity) continue;

        if (capacity.workCenter.schedulingMode === "Infinite") {
          const beforeDate =
            op.startDate || ctx.now.toISOString().slice(0, 10);
          const dbLoad = await this.calculateLoadBeforeDate(wcId, beforeDate);
          const load = dbLoad + this.getInMemoryLoad(wcId);
          if (!bestInfinite || load < bestInfinite.load) {
            bestInfinite = { wcId, load };
          }
          continue;
        }

        const requirements: AbilityRequirement[] =
          opRequirements ??
          (capacity.workCenter.requiredAbilityId
            ? [
                {
                  abilityId: capacity.workCenter.requiredAbilityId,
                  abilityName:
                    ctx.abilityNamesById.get(
                      capacity.workCenter.requiredAbilityId
                    ) ?? "required ability",
                  minimumProficiency: null,
                },
              ]
            : []);

        const pools = requirements.map((r) =>
          this.buildOperatorPool(r, earliestStart, ctx)
        );

        const durationHours =
          durationBase / (capacity.workCenter.efficiencyFactor || 1);

        const result = allocateOperation({
          durationHours,
          earliestStart,
          horizonEnd,
          capacity,
          operatorPools: pools,
        });

        if (isConflict(result)) {
          if (!firstConflict) {
            firstConflict = result.conflict;
          }
          continue;
        }

        const reservedMs = capacity.reservations.reduce(
          (sum, r) => sum + (r.endAt.getTime() - r.startAt.getTime()),
          0
        );

        if (
          !bestFinite ||
          result.end.getTime() < bestFinite.slot.end.getTime() ||
          (result.end.getTime() === bestFinite.slot.end.getTime() &&
            reservedMs < bestFinite.reservedMs)
        ) {
          bestFinite = { wcId, slot: result, reservedMs, capacity, requirements };
        }
      }

      if (bestFinite) {
        const { wcId, slot, capacity, requirements } = bestFinite;

        // Commit in-run so subsequent operations see this placement
        capacity.reservations.push({ startAt: slot.start, endAt: slot.end });
        this.plannedReservations.push({
          resourceKind: "WorkCenter",
          resourceId: wcId,
          operationId: op.id,
          startAt: slot.start,
          endAt: slot.end,
        });
        for (const r of requirements) {
          const list = ctx.poolReservationsByAbility.get(r.abilityId) ?? [];
          list.push({ startAt: slot.start, endAt: slot.end });
          ctx.poolReservationsByAbility.set(r.abilityId, list);
          this.plannedReservations.push({
            resourceKind: "OperatorPool",
            resourceId: r.abilityId,
            operationId: op.id,
            startAt: slot.start,
            endAt: slot.end,
          });
        }
        placedEndByOperation.set(op.id, slot.end);
        this.addInMemoryLoad(wcId, durationBase);

        // Late vs the DAG-computed due date => surface as a conflict
        let conflict: string | null = null;
        const placedEndDate = slot.end.toISOString().slice(0, 10);
        if (op.dueDate && placedEndDate > op.dueDate) {
          conflict = `No capacity before due date: finite capacity pushes finish to ${placedEndDate} (due ${op.dueDate})`;
        }

        selections.set(op.id, {
          workCenterId: wcId,
          priority: 0,
          placedStart: slot.start.toISOString(),
          placedEnd: slot.end.toISOString(),
          conflict,
        });
      } else if (bestInfinite) {
        selections.set(op.id, {
          workCenterId: bestInfinite.wcId,
          priority: 0,
          load: bestInfinite.load,
        });
        this.addInMemoryLoad(bestInfinite.wcId, durationBase);
      } else {
        // Every finite candidate conflicted (machine, skill, or calendar):
        // keep the legacy least-loaded assignment so the op still has a work
        // center, and surface the cause
        const legacy = await this.selectWorkCenter(op.processId, op.startDate);
        selections.set(op.id, {
          ...legacy,
          conflict: firstConflict ?? "No feasible capacity slot",
        });
        if (legacy.workCenterId) {
          this.addInMemoryLoad(legacy.workCenterId, durationBase);
        }
      }
    }

    return selections;
  }

  private buildOperatorPool(
    requirement: AbilityRequirement,
    earliestStart: Date,
    ctx: FiniteSchedulingContext
  ): OperatorPool {
    const employees = ctx.employeesByAbility.get(requirement.abilityId) ?? [];

    const poolSize = employees.filter((e) =>
      isEligibleOperator(e, requirement.minimumProficiency, earliestStart)
    ).length;

    // Return the SAME array instance stored in the context so in-run pushes
    // are visible to later allocations
    let reservations = ctx.poolReservationsByAbility.get(requirement.abilityId);
    if (!reservations) {
      reservations = [];
      ctx.poolReservationsByAbility.set(requirement.abilityId, reservations);
    }

    return {
      abilityId: requirement.abilityId,
      abilityName: requirement.abilityName,
      poolSize,
      reservations,
    };
  }
}

/**
 * Apply work center selections to scheduled operations
 */
export function applyWorkCenterSelections(
  operations: Map<string, ScheduledOperation>,
  selections: Map<string, WorkCenterSelection>
): Map<string, ScheduledOperation> {
  const result = new Map<string, ScheduledOperation>();

  for (const [opId, op] of operations) {
    const selection = selections.get(opId);
    if (selection?.workCenterId) {
      const updated: ScheduledOperation = {
        ...op,
        workCenterId: selection.workCenterId,
      };

      // Finite placement overrides the infinite-capacity dates
      if (selection.placedStart && selection.placedEnd) {
        updated.startDate = selection.placedStart.slice(0, 10);
        updated.dueDate = selection.placedEnd.slice(0, 10);
      }

      if (selection.conflict) {
        updated.hasConflict = true;
        updated.conflictReason = selection.conflict;
      }

      result.set(opId, updated);
    } else if (selection?.conflict) {
      result.set(opId, {
        ...op,
        hasConflict: true,
        conflictReason: selection.conflict,
      });
    } else {
      result.set(opId, op);
    }
  }

  return result;
}
