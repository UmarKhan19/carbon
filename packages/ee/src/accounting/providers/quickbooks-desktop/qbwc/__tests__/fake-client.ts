import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * In-memory PostgREST stand-in for the QBWC handler conversation tests.
 * Emulates exactly the supabase-js chains the handler's service surface
 * uses (core/operations.ts, qbwc/session.ts, core/service.ts):
 *
 *   .from(t).select(cols?, { count })…filters…[.order][.limit|.range]      (thenable)
 *   .from(t).select(…)…filters….single() / .maybeSingle()
 *   .from(t).insert(row).select("*").single()
 *   .from(t).update(patch)…filters…[.select("*")][.single()]               (thenable)
 *
 * Filters: eq, in, lt, not("col","is",null), not("col","in","(\"a\")"),
 * or("companyId.eq.X,…") — the or() supports only the companyId clause of
 * getAccountingIntegration's matcher (json-path clauses never match, which
 * is correct for webConnector credentials). `count: "exact"` counts the
 * filtered set BEFORE order/limit/range, like PostgREST.
 *
 * Not a test file — imported by handler-auth.test.ts / handler-loop.test.ts.
 */

export type FakeRow = Record<string, any>;

type RowFilter = (row: FakeRow) => boolean;

type FakeResult = {
  data: any;
  error: { message: string; code?: string } | null;
  count: number | null;
};

function parsePostgrestList(value: string): string[] {
  return value
    .replace(/^\(/, "")
    .replace(/\)$/, "")
    .split(",")
    .map((entry) => entry.trim().replace(/^"/, "").replace(/"$/, ""))
    .filter((entry) => entry.length > 0);
}

class FakeQueryBuilder {
  private filters: RowFilter[] = [];
  private orderings: Array<{ column: string; ascending: boolean }> = [];
  private limitCount: number | null = null;
  private rangeBounds: [number, number] | null = null;
  private mode: "select" | "insert" | "update" = "select";
  private patch: FakeRow | null = null;
  private insertRow: FakeRow | null = null;
  private wantCount = false;

  constructor(
    private store: FakeCarbonStore,
    private table: string
  ) {}

  select(_columns?: string, options?: { count?: string }) {
    if (this.mode === "select" && options?.count === "exact") {
      this.wantCount = true;
    }
    return this;
  }

  insert(row: FakeRow) {
    this.mode = "insert";
    this.insertRow = row;
    return this;
  }

  update(patch: FakeRow) {
    this.mode = "update";
    this.patch = patch;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  in(column: string, values: readonly unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  lt(column: string, value: string) {
    this.filters.push(
      (row) =>
        row[column] !== null && row[column] !== undefined && row[column] < value
    );
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    if (operator === "is" && value === null) {
      this.filters.push(
        (row) => row[column] !== null && row[column] !== undefined
      );
      return this;
    }
    if (operator === "in") {
      const excluded = parsePostgrestList(String(value));
      this.filters.push((row) => !excluded.includes(row[column]));
      return this;
    }
    throw new Error(`FakeQueryBuilder.not: unsupported operator "${operator}"`);
  }

  or(expression: string) {
    const clauses = expression.split(",").map((clause) => {
      if (clause.startsWith("companyId.eq.")) {
        const value = clause.slice("companyId.eq.".length);
        return (row: FakeRow) => row.companyId === value;
      }
      // json-path clauses (metadata->credentials->>tenantId…) never match
      return () => false;
    });
    this.filters.push((row) => clauses.some((matches) => matches(row)));
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orderings.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number) {
    this.rangeBounds = [from, to];
    return this;
  }

  single(): Promise<FakeResult> {
    const { rows } = this.execute();
    if (rows.length === 1) {
      return Promise.resolve({ data: rows[0], error: null, count: null });
    }
    return Promise.resolve({
      data: null,
      error: {
        message: `JSON object requested, multiple (or no) rows returned: got ${rows.length}`,
        code: "PGRST116"
      },
      count: null
    });
  }

  maybeSingle(): Promise<FakeResult> {
    const { rows } = this.execute();
    if (rows.length > 1) {
      return Promise.resolve({
        data: null,
        error: {
          message: `expected at most one row, got ${rows.length}`,
          code: "PGRST116"
        },
        count: null
      });
    }
    return Promise.resolve({ data: rows[0] ?? null, error: null, count: null });
  }

  then<TResult1 = FakeResult, TResult2 = never>(
    onfulfilled?:
      | ((value: FakeResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    const { rows, count } = this.execute();
    return Promise.resolve({ data: rows, error: null, count }).then(
      onfulfilled,
      onrejected
    );
  }

  private execute(): { rows: FakeRow[]; count: number | null } {
    const tableRows = this.store.rows(this.table);

    if (this.mode === "insert") {
      const inserted = {
        ...this.store.defaultsFor(this.table),
        ...this.insertRow
      };
      tableRows.push(inserted);
      return { rows: [{ ...inserted }], count: null };
    }

    let matched = tableRows.filter((row) =>
      this.filters.every((filter) => filter(row))
    );

    if (this.mode === "update") {
      for (const row of matched) {
        Object.assign(row, this.patch);
      }
      return { rows: matched.map((row) => ({ ...row })), count: null };
    }

    const count = this.wantCount ? matched.length : null;

    for (const { column, ascending } of [...this.orderings].reverse()) {
      matched = [...matched].sort((a, b) => {
        const left = a[column] ?? "";
        const right = b[column] ?? "";
        const comparison = left < right ? -1 : left > right ? 1 : 0;
        return ascending ? comparison : -comparison;
      });
    }

    if (this.rangeBounds) {
      matched = matched.slice(this.rangeBounds[0], this.rangeBounds[1] + 1);
    }
    if (this.limitCount !== null) {
      matched = matched.slice(0, this.limitCount);
    }

    return { rows: matched.map((row) => ({ ...row })), count };
  }
}

export class FakeCarbonStore {
  private tables = new Map<string, FakeRow[]>();
  private sequence = 0;

  rows(table: string): FakeRow[] {
    const existing = this.tables.get(table);
    if (existing) return existing;
    const created: FakeRow[] = [];
    this.tables.set(table, created);
    return created;
  }

  seed(table: string, row: FakeRow): FakeRow {
    const seeded = { ...this.defaultsFor(table), ...row };
    this.rows(table).push(seeded);
    return seeded;
  }

  find(table: string, id: string): FakeRow | undefined {
    return this.rows(table).find((row) => row.id === id);
  }

  nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  defaultsFor(table: string): FakeRow {
    const now = new Date().toISOString();
    switch (table) {
      case "qbwcSession":
        return {
          id: this.nextId("qbwc"),
          status: "Open",
          currentMessageSetId: null,
          claimedOperationIds: null,
          requestsSent: 0,
          qbxmlMajorVersion: null,
          lastSeenAt: now,
          closedAt: null,
          errorMessage: null,
          createdAt: now,
          updatedBy: null,
          updatedAt: null
        };
      case "accountingSyncOperation":
        return {
          id: this.nextId("op"),
          status: "Pending",
          attemptCount: 0,
          lastAttemptAt: null,
          completedAt: null,
          errorCode: null,
          errorMessage: null,
          externalId: null,
          metadata: null,
          createdBy: "user-1",
          createdAt: now,
          updatedBy: null,
          updatedAt: null
        };
      default:
        return {};
    }
  }

  client(): SupabaseClient<Database> {
    const store = this;
    return {
      from(table: string) {
        return new FakeQueryBuilder(store, table);
      }
    } as unknown as SupabaseClient<Database>;
  }
}
