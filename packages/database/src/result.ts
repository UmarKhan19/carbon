import { DatabaseError, NotFoundError, Result } from "@carbon/result";
import type { PostgrestError } from "@supabase/postgrest-js";
import type { Kysely, Transaction } from "kysely";

/**
 * Adapters that turn the database's native shapes (Supabase `{ data, error }`
 * responses and thrown Kysely exceptions) into a `Result`. They live here, not
 * in `@carbon/result`, so the result package stays free of Supabase/Kysely
 * types. After this, no service hands a raw database error upward.
 */

type QueryResponse<T> = {
  data: T | null;
  error: PostgrestError | null;
};

/** Identifies the record a query targets, so a missing row becomes a NotFoundError. */
export type QueryEntity = {
  entity: string;
  id?: string;
};

/**
 * Runs a Supabase query and maps it to a Result: a PostgrestError becomes a
 * DatabaseError (raw error preserved on `cause` for logging), and — when entity
 * context is supplied — a "no rows" outcome becomes a NotFoundError.
 *
 * Pass entity context for single-row reads (`.single()`); omit it for list
 * queries that cannot meaningfully "not found".
 */
export function fromQuery<T>(
  query: PromiseLike<QueryResponse<T>>,
  entity: QueryEntity
): Promise<Result<NonNullable<T>, NotFoundError | DatabaseError>>;
export function fromQuery<T>(
  query: PromiseLike<QueryResponse<T>>
): Promise<Result<T, DatabaseError>>;
export async function fromQuery<T>(
  query: PromiseLike<QueryResponse<T>>,
  entity?: QueryEntity
): Promise<Result<T, NotFoundError | DatabaseError>> {
  const { data, error } = await query;

  if (error) {
    // PGRST116 = the `.single()` query returned zero rows.
    if (entity && error.code === "PGRST116") {
      return Result.err(
        new NotFoundError({
          entity: entity.entity,
          id: entity.id,
          cause: error
        })
      );
    }
    return Result.err(new DatabaseError({ operation: "query", cause: error }));
  }

  if (entity && (data === null || data === undefined)) {
    return Result.err(
      new NotFoundError({ entity: entity.entity, id: entity.id })
    );
  }

  return Result.ok(data as T);
}

/**
 * Runs a Kysely transaction and maps a thrown exception to a DatabaseError, so a
 * transactional service returns a Result like everyone else. Domain pre-flight
 * checks (NotFound/Conflict) should happen before the transaction; any throw
 * inside it is treated as an unexpected database failure.
 */
export async function fromTransaction<DB, T>(
  db: Kysely<DB>,
  fn: (trx: Transaction<DB>) => Promise<T>,
  options?: { operation?: string }
): Promise<Result<T, DatabaseError>> {
  try {
    const value = await db.transaction().execute(fn);
    return Result.ok(value);
  } catch (cause) {
    return Result.err(
      new DatabaseError({ operation: options?.operation, cause })
    );
  }
}
