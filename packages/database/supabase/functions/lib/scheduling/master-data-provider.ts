import type { SupabaseClient } from "@supabase/supabase-js";
import type { Kysely } from "kysely";
import type { DB } from "../database.ts";
import { getJobMethodTree, type JobMethodTreeItem } from "../methods.ts";
import type { Database } from "../types.ts";
import { toIsoDate } from "./date-utils.ts";
import type { BaseOperation, Job, JobOperationDependency } from "./types.ts";

export type JobMaterialWithMakeMethod = {
  jobMaterialMakeMethodId: string | null;
  jobOperationId: string | null;
};

export type UnassignedMaterial = {
  id: string | null;
  jobMakeMethodId: string | null;
};

export type UnlinkedMaterial = {
  id: string | null;
  jobMakeMethodId: string;
};

export type RootMakeMethod = {
  id: string | null;
  itemId: string | null;
};

export type ProcessWorkCenters = {
  id: string | null;
  workCenters: string[] | null;
};

export type ActiveWorkCenter = {
  id: string | null;
  locationId: string | null;
};

export type WorkCenterLoadOperation = {
  setupTime: number | null;
  setupUnit: Database["public"]["Enums"]["factor"] | null;
  laborTime: number | null;
  laborUnit: Database["public"]["Enums"]["factor"] | null;
  machineTime: number | null;
  machineUnit: Database["public"]["Enums"]["factor"] | null;
  operationQuantity: number | null;
};

export type CrossJobOperation = {
  id: string | null;
  dueDate: string | null;
  startDate: string | null;
  priority: number | null;
  deadlineType: Database["public"]["Enums"]["deadlineType"] | null;
  jobPriority: number | null;
  workCenterId: string | null;
};

export type WorkCenterCapacityInfo = {
  id: string;
  parallelCapacity: number;
  efficiencyFactor: number;
  schedulingMode: "Finite" | "Infinite";
  resourceCalendarId: string | null;
  requiredAbilityId: string | null;
  locationId: string | null;
  timezone: string;
};

export type CalendarPattern = {
  workCenterId: string;
  timezone: string;
  shifts: { dayOfWeek: number; startTime: string; endTime: string }[];
  exceptions: {
    startAt: string;
    endAt: string;
    type: "Closed" | "Open" | "ReducedCapacity";
    capacityOverride: number | null;
  }[];
};

export type CapacityOverride = {
  workCenterId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  parallelCapacity: number;
};

export type LiveReservation = {
  resourceKind: "WorkCenter" | "OperatorPool";
  resourceId: string;
  startAt: Date;
  endAt: Date;
};

export type SchedulingPolicyRow = {
  workCenterId: string | null;
  dispatchRule: "FIFO" | "EDD" | "SPT" | "WSPT" | "CR" | "MinSlack";
};

export type OperationAbilityRequirement = {
  operationId: string;
  abilityId: string;
  abilityName: string;
  minimumProficiency: number | null;
};

export type ProcessAbilityRequirement = {
  processId: string;
  abilityId: string;
  abilityName: string;
  minimumProficiency: number | null;
};

export type QualifiedEmployeeRow = {
  abilityId: string;
  employeeId: string;
  active: boolean;
  trainingCompleted: boolean | null;
  lastTrainingDate: string | null;
  expiresAt: string | null;
  proficiencyOverride: number | null;
  curve: unknown;
  shadowWeeks: number;
};

export type AbilityNameRow = { id: string; name: string };

/**
 * Master Data Provider
 * The single read seam for the scheduling engine. All master/transactional
 * reads go through this interface so the engine can later be pointed at
 * "live ⊕ scenario overrides" without touching the placement logic.
 * Writes stay on the concrete Kysely client.
 */
export interface MasterDataProvider {
  getJob(jobId: string): Promise<Job | undefined>;
  getOperations(
    jobId: string,
    opts?: { includeDone?: boolean }
  ): Promise<BaseOperation[]>;
  getDependencies(jobId: string): Promise<JobOperationDependency[]>;
  getReworkDependencies(
    jobId: string,
    reworkOpIds: string[]
  ): Promise<JobOperationDependency[]>;
  getMaterialsWithMakeMethod(
    makeMethodIds: string[]
  ): Promise<JobMaterialWithMakeMethod[]>;
  getUnassignedMakeToOrderMaterials(
    makeMethodIds: string[]
  ): Promise<UnassignedMaterial[]>;
  getUnlinkedMaterials(jobId: string): Promise<UnlinkedMaterial[]>;
  getRootMakeMethod(jobId: string): Promise<RootMakeMethod | undefined>;
  getJobMethodTree(
    methodId: string
  ): Promise<{ data: JobMethodTreeItem[] | null; error: unknown }>;
  getProcessesWithWorkCenters(): Promise<ProcessWorkCenters[]>;
  getActiveWorkCenters(locationId: string): Promise<ActiveWorkCenter[]>;
  getWorkCenterLoadOperations(
    workCenterId: string,
    beforeDate: string
  ): Promise<WorkCenterLoadOperation[]>;
  getCrossJobOperationsAtWorkCenters(
    workCenterIds: string[]
  ): Promise<CrossJobOperation[]>;

  // ---- finite-capacity reads ----
  getWorkCenterCapacityInfo(
    workCenterIds: string[]
  ): Promise<WorkCenterCapacityInfo[]>;
  getWorkCenterCalendars(
    workCenters: WorkCenterCapacityInfo[]
  ): Promise<CalendarPattern[]>;
  getWorkCenterCapacityOverrides(
    workCenterIds: string[]
  ): Promise<CapacityOverride[]>;
  getLiveReservations(
    fromDate: Date,
    excludeJobId: string
  ): Promise<LiveReservation[]>;
  getSchedulingPolicies(): Promise<SchedulingPolicyRow[]>;
  getOperationRequiredAbilities(
    operationIds: string[]
  ): Promise<OperationAbilityRequirement[]>;
  getProcessAbilities(
    processIds: string[]
  ): Promise<ProcessAbilityRequirement[]>;
  getQualifiedEmployees(abilityIds: string[]): Promise<QualifiedEmployeeRow[]>;
  getAbilityNames(abilityIds: string[]): Promise<AbilityNameRow[]>;
}

/**
 * Live implementation backed by Kysely (and the Supabase client for the
 * job-method-tree RPC). Queries are moved verbatim from the engine,
 * work-center selector, assembly handler, and material manager.
 */
export class KyselyMasterDataProvider implements MasterDataProvider {
  private db: Kysely<DB>;
  private client: SupabaseClient<Database>;
  private companyId: string;

  constructor(
    db: Kysely<DB>,
    client: SupabaseClient<Database>,
    companyId: string
  ) {
    this.db = db;
    this.client = client;
    this.companyId = companyId;
  }

  async getJob(jobId: string): Promise<Job | undefined> {
    return await this.db
      .selectFrom("job")
      .select(["id", "dueDate", "deadlineType", "locationId", "priority"])
      .where("id", "=", jobId)
      .executeTakeFirst();
  }

  async getOperations(
    jobId: string,
    opts?: { includeDone?: boolean }
  ): Promise<BaseOperation[]> {
    let query = this.db
      .selectFrom("jobOperation")
      .selectAll()
      .where("jobId", "=", jobId);

    if (!opts?.includeDone) {
      query = query.where("status", "not in", ["Done", "Canceled"]);
    }

    return (await query.orderBy("order").execute()) as BaseOperation[];
  }

  async getDependencies(jobId: string): Promise<JobOperationDependency[]> {
    const deps = await this.db
      .selectFrom("jobOperationDependency")
      .selectAll()
      .where("jobId", "=", jobId)
      .execute();

    return deps.map((d) => ({
      operationId: d.operationId,
      dependsOnId: d.dependsOnId,
      jobId: d.jobId,
    }));
  }

  async getReworkDependencies(
    jobId: string,
    reworkOpIds: string[]
  ): Promise<JobOperationDependency[]> {
    if (reworkOpIds.length === 0) {
      return [];
    }

    const deps = await this.db
      .selectFrom("jobOperationDependency")
      .selectAll()
      .where("jobId", "=", jobId)
      .where((eb) =>
        eb.or([
          eb("operationId", "in", reworkOpIds),
          eb("dependsOnId", "in", reworkOpIds),
        ])
      )
      .execute();

    return deps.map((d) => ({
      operationId: d.operationId,
      dependsOnId: d.dependsOnId,
      jobId: d.jobId,
    }));
  }

  async getMaterialsWithMakeMethod(
    makeMethodIds: string[]
  ): Promise<JobMaterialWithMakeMethod[]> {
    if (makeMethodIds.length === 0) {
      return [];
    }

    return await this.db
      .selectFrom("jobMaterialWithMakeMethodId")
      .selectAll()
      .where("jobMakeMethodId", "in", makeMethodIds)
      .execute();
  }

  async getUnassignedMakeToOrderMaterials(
    makeMethodIds: string[]
  ): Promise<UnassignedMaterial[]> {
    if (makeMethodIds.length === 0) {
      return [];
    }

    return await this.db
      .selectFrom("jobMaterial")
      .select(["id", "jobMakeMethodId"])
      .where("jobMakeMethodId", "in", makeMethodIds)
      .where("methodType", "=", "Make to Order")
      .where("jobOperationId", "is", null)
      .execute();
  }

  async getUnlinkedMaterials(jobId: string): Promise<UnlinkedMaterial[]> {
    return await this.db
      .selectFrom("jobMaterial")
      .select(["id", "jobMakeMethodId"])
      .where("jobId", "=", jobId)
      .where("jobOperationId", "is", null)
      .execute();
  }

  async getRootMakeMethod(jobId: string): Promise<RootMakeMethod | undefined> {
    return await this.db
      .selectFrom("jobMakeMethod")
      .select(["id", "itemId"])
      .where("jobId", "=", jobId)
      .where("parentMaterialId", "is", null)
      .executeTakeFirst();
  }

  async getJobMethodTree(
    methodId: string
  ): Promise<{ data: JobMethodTreeItem[] | null; error: unknown }> {
    return await getJobMethodTree(this.client, methodId);
  }

  async getProcessesWithWorkCenters(): Promise<ProcessWorkCenters[]> {
    return await this.db
      .selectFrom("processes")
      .select(["id", "workCenters"])
      .where("companyId", "=", this.companyId)
      .execute();
  }

  async getActiveWorkCenters(
    locationId: string
  ): Promise<ActiveWorkCenter[]> {
    return await this.db
      .selectFrom("workCenter")
      .select(["id", "locationId"])
      .where("locationId", "=", locationId)
      .where("companyId", "=", this.companyId)
      .where("active", "=", true)
      .execute();
  }

  async getWorkCenterLoadOperations(
    workCenterId: string,
    beforeDate: string
  ): Promise<WorkCenterLoadOperation[]> {
    return await this.db
      .selectFrom("jobOperation")
      .select([
        "setupTime",
        "setupUnit",
        "laborTime",
        "laborUnit",
        "machineTime",
        "machineUnit",
        "operationQuantity",
      ])
      .where("workCenterId", "=", workCenterId)
      .where("companyId", "=", this.companyId)
      .where("status", "not in", ["Done", "Canceled"])
      .where((eb) =>
        eb.or([eb("startDate", "<=", beforeDate), eb("startDate", "is", null)])
      )
      .execute();
  }

  async getCrossJobOperationsAtWorkCenters(
    workCenterIds: string[]
  ): Promise<CrossJobOperation[]> {
    if (workCenterIds.length === 0) {
      return [];
    }

    return await this.db
      .selectFrom("jobOperation as jo")
      .innerJoin("job as j", "j.id", "jo.jobId")
      .select([
        "jo.id",
        "jo.dueDate",
        "jo.startDate",
        "jo.priority",
        "j.deadlineType",
        "j.priority as jobPriority",
        "jo.workCenterId",
      ])
      .where("jo.workCenterId", "in", workCenterIds)
      .where("jo.status", "not in", ["Done", "Canceled"])
      .execute();
  }

  async getWorkCenterCapacityInfo(
    workCenterIds: string[]
  ): Promise<WorkCenterCapacityInfo[]> {
    if (workCenterIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .selectFrom("workCenter as wc")
      .leftJoin("location as l", "l.id", "wc.locationId")
      .select([
        "wc.id",
        "wc.parallelCapacity",
        "wc.efficiencyFactor",
        "wc.schedulingMode",
        "wc.resourceCalendarId",
        "wc.requiredAbilityId",
        "wc.locationId",
        "l.timezone",
      ])
      .where("wc.id", "in", workCenterIds)
      .where("wc.companyId", "=", this.companyId)
      .execute();

    return rows.map((r) => ({
      id: r.id!,
      parallelCapacity: Number(r.parallelCapacity ?? 1),
      efficiencyFactor: Number(r.efficiencyFactor ?? 1),
      schedulingMode: (r.schedulingMode ?? "Finite") as "Finite" | "Infinite",
      resourceCalendarId: r.resourceCalendarId,
      requiredAbilityId: r.requiredAbilityId,
      locationId: r.locationId,
      timezone: r.timezone ?? "UTC",
    }));
  }

  async getWorkCenterCalendars(
    workCenters: WorkCenterCapacityInfo[]
  ): Promise<CalendarPattern[]> {
    if (workCenters.length === 0) {
      return [];
    }

    // Resolve each work center's calendar set: its explicit calendar, else
    // all active calendars at its location (location-default fallback).
    const explicitIds = workCenters
      .map((wc) => wc.resourceCalendarId)
      .filter((id): id is string => id !== null);
    const fallbackLocationIds = Array.from(
      new Set(
        workCenters
          .filter((wc) => wc.resourceCalendarId === null && wc.locationId)
          .map((wc) => wc.locationId as string)
      )
    );

    const calendars: {
      id: string;
      locationId: string | null;
    }[] = [];

    if (explicitIds.length > 0) {
      const rows = await this.db
        .selectFrom("resourceCalendar")
        .select(["id", "locationId"])
        .where("id", "in", explicitIds)
        .where("companyId", "=", this.companyId)
        .execute();
      calendars.push(
        ...rows.map((r) => ({ id: r.id!, locationId: r.locationId }))
      );
    }

    const calendarsByLocation = new Map<string, string[]>();
    if (fallbackLocationIds.length > 0) {
      const rows = await this.db
        .selectFrom("resourceCalendar")
        .select(["id", "locationId"])
        .where("locationId", "in", fallbackLocationIds)
        .where("companyId", "=", this.companyId)
        .where("active", "=", true)
        .execute();
      for (const r of rows) {
        if (!r.id || !r.locationId) continue;
        calendars.push({ id: r.id, locationId: r.locationId });
        const list = calendarsByLocation.get(r.locationId) ?? [];
        list.push(r.id);
        calendarsByLocation.set(r.locationId, list);
      }
    }

    const allCalendarIds = Array.from(new Set(calendars.map((c) => c.id)));

    const shiftsByCalendar = new Map<
      string,
      { dayOfWeek: number; startTime: string; endTime: string }[]
    >();
    const exceptionsByCalendar = new Map<
      string,
      CalendarPattern["exceptions"]
    >();

    if (allCalendarIds.length > 0) {
      const shiftRows = await this.db
        .selectFrom("resourceCalendarShift")
        .select(["resourceCalendarId", "dayOfWeek", "startTime", "endTime"])
        .where("resourceCalendarId", "in", allCalendarIds)
        .where("companyId", "=", this.companyId)
        .execute();
      for (const s of shiftRows) {
        const list = shiftsByCalendar.get(s.resourceCalendarId) ?? [];
        list.push({
          dayOfWeek: s.dayOfWeek,
          startTime: String(s.startTime),
          endTime: String(s.endTime),
        });
        shiftsByCalendar.set(s.resourceCalendarId, list);
      }

      const exceptionRows = await this.db
        .selectFrom("resourceCalendarException")
        .select([
          "resourceCalendarId",
          "startAt",
          "endAt",
          "type",
          "capacityOverride",
        ])
        .where("resourceCalendarId", "in", allCalendarIds)
        .where("companyId", "=", this.companyId)
        .execute();
      for (const e of exceptionRows) {
        const list = exceptionsByCalendar.get(e.resourceCalendarId) ?? [];
        list.push({
          startAt: new Date(e.startAt as unknown as string).toISOString(),
          endAt: new Date(e.endAt as unknown as string).toISOString(),
          type: e.type as "Closed" | "Open" | "ReducedCapacity",
          capacityOverride:
            e.capacityOverride === null ? null : Number(e.capacityOverride),
        });
        exceptionsByCalendar.set(e.resourceCalendarId, list);
      }
    }

    return workCenters.map((wc) => {
      const calendarIds = wc.resourceCalendarId
        ? [wc.resourceCalendarId]
        : wc.locationId
        ? calendarsByLocation.get(wc.locationId) ?? []
        : [];

      const shifts = calendarIds.flatMap(
        (id) => shiftsByCalendar.get(id) ?? []
      );
      const exceptions = calendarIds.flatMap(
        (id) => exceptionsByCalendar.get(id) ?? []
      );

      return { workCenterId: wc.id, timezone: wc.timezone, shifts, exceptions };
    });
  }

  async getWorkCenterCapacityOverrides(
    workCenterIds: string[]
  ): Promise<CapacityOverride[]> {
    if (workCenterIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .selectFrom("workCenterCapacity")
      .select([
        "workCenterId",
        "effectiveFrom",
        "effectiveTo",
        "parallelCapacity",
      ])
      .where("workCenterId", "in", workCenterIds)
      .where("companyId", "=", this.companyId)
      .execute();

    return rows.map((r) => ({
      workCenterId: r.workCenterId,
      effectiveFrom: toIsoDate(r.effectiveFrom)!,
      effectiveTo: toIsoDate(r.effectiveTo),
      parallelCapacity: Number(r.parallelCapacity),
    }));
  }

  async getLiveReservations(
    fromDate: Date,
    excludeJobId: string
  ): Promise<LiveReservation[]> {
    const rows = await this.db
      .selectFrom("capacityReservation")
      .select(["resourceKind", "resourceId", "startAt", "endAt"])
      .where("companyId", "=", this.companyId)
      .where("scenarioId", "is", null)
      .where("jobId", "!=", excludeJobId)
      .where("endAt", ">", fromDate.toISOString())
      .execute();

    return rows.map((r) => ({
      resourceKind: r.resourceKind as "WorkCenter" | "OperatorPool",
      resourceId: r.resourceId,
      startAt: new Date(r.startAt as unknown as string),
      endAt: new Date(r.endAt as unknown as string),
    }));
  }

  async getSchedulingPolicies(): Promise<SchedulingPolicyRow[]> {
    const rows = await this.db
      .selectFrom("schedulingPolicy")
      .select(["workCenterId", "dispatchRule"])
      .where("companyId", "=", this.companyId)
      .execute();

    return rows.map((r) => ({
      workCenterId: r.workCenterId,
      dispatchRule: r.dispatchRule as SchedulingPolicyRow["dispatchRule"],
    }));
  }

  async getOperationRequiredAbilities(
    operationIds: string[]
  ): Promise<OperationAbilityRequirement[]> {
    if (operationIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .selectFrom("jobOperationAbility as joa")
      .innerJoin("ability as a", "a.id", "joa.abilityId")
      .select([
        "joa.operationId",
        "joa.abilityId",
        "joa.minimumProficiency",
        "a.name as abilityName",
      ])
      .where("joa.operationId", "in", operationIds)
      .where("joa.companyId", "=", this.companyId)
      .execute();

    return rows.map((r) => ({
      operationId: r.operationId,
      abilityId: r.abilityId,
      abilityName: r.abilityName,
      minimumProficiency:
        r.minimumProficiency === null ? null : Number(r.minimumProficiency),
    }));
  }

  async getProcessAbilities(
    processIds: string[]
  ): Promise<ProcessAbilityRequirement[]> {
    if (processIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .selectFrom("processAbility as pa")
      .innerJoin("ability as a", "a.id", "pa.abilityId")
      .select([
        "pa.processId",
        "pa.abilityId",
        "pa.minimumProficiency",
        "a.name as abilityName",
      ])
      .where("pa.processId", "in", processIds)
      .where("pa.companyId", "=", this.companyId)
      .execute();

    return rows.map((r) => ({
      processId: r.processId,
      abilityId: r.abilityId,
      abilityName: r.abilityName,
      minimumProficiency:
        r.minimumProficiency === null ? null : Number(r.minimumProficiency),
    }));
  }

  async getQualifiedEmployees(
    abilityIds: string[]
  ): Promise<QualifiedEmployeeRow[]> {
    if (abilityIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .selectFrom("employeeAbility as ea")
      .innerJoin("ability as a", "a.id", "ea.abilityId")
      .select([
        "ea.abilityId",
        "ea.employeeId",
        "ea.active",
        "ea.trainingCompleted",
        "ea.lastTrainingDate",
        "ea.expiresAt",
        "ea.proficiencyOverride",
        "a.curve",
        "a.shadowWeeks",
      ])
      .where("ea.abilityId", "in", abilityIds)
      .where("ea.companyId", "=", this.companyId)
      .execute();

    return rows.map((r) => ({
      abilityId: r.abilityId,
      employeeId: r.employeeId,
      active: Boolean(r.active),
      trainingCompleted: r.trainingCompleted,
      lastTrainingDate: toIsoDate(r.lastTrainingDate),
      expiresAt: toIsoDate(r.expiresAt),
      proficiencyOverride:
        r.proficiencyOverride === null ? null : Number(r.proficiencyOverride),
      curve: r.curve,
      shadowWeeks: Number(r.shadowWeeks ?? 0),
    }));
  }

  async getAbilityNames(abilityIds: string[]): Promise<AbilityNameRow[]> {
    if (abilityIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .selectFrom("ability")
      .select(["id", "name"])
      .where("id", "in", abilityIds)
      .where("companyId", "=", this.companyId)
      .execute();

    return rows.map((r) => ({ id: r.id!, name: r.name }));
  }
}
