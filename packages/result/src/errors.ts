import { msg } from "@lingui/core/macro";
import { createCarbonError } from "./error";

/**
 * The six Core Errors — a closed, cross-cutting set shared by every domain.
 * Module-specific failures are defined next to their service with
 * `createCarbonError`, not added here.
 */

/** A requested record does not exist. */
export class NotFoundError extends createCarbonError<
  "NotFoundError",
  { entity: string; id?: string }
>(
  "NotFoundError",
  msg({ id: "error.notFound", message: "{entity} not found" })
) {}

/**
 * A value failed a domain validation check. Distinct from form validation,
 * which keeps using `validationError` and is unaffected by Result.
 */
export class ValidationError extends createCarbonError<
  "ValidationError",
  { reason?: string }
>(
  "ValidationError",
  msg({ id: "error.validation", message: "Validation failed" })
) {}

/**
 * The operation is valid, but the current state already blocks or satisfies it
 * (e.g. "already clocked in"). Contrast with {@link BusinessRuleError}.
 */
export class ConflictError extends createCarbonError<
  "ConflictError",
  { entity?: string }
>(
  "ConflictError",
  msg({
    id: "error.conflict",
    message: "This action conflicts with the current state"
  })
) {}

/**
 * The operation itself would violate a domain invariant (e.g. "insufficient
 * quantity", "debits must equal credits"). Contrast with {@link ConflictError}.
 */
export class BusinessRuleError extends createCarbonError<
  "BusinessRuleError",
  { rule?: string }
>(
  "BusinessRuleError",
  msg({
    id: "error.businessRule",
    message: "This action is not allowed by a business rule"
  })
) {}

/**
 * A database operation failed. Shows a generic, safe message; the raw error
 * (e.g. a PostgrestError) is preserved on `cause` and logged at the boundary so
 * no schema internals ever reach a user toast.
 */
export class DatabaseError extends createCarbonError<
  "DatabaseError",
  { operation?: string }
>(
  "DatabaseError",
  msg({
    id: "error.database",
    message: "Something went wrong while saving your changes"
  })
) {}

/** A call to an external service failed. */
export class ExternalServiceError extends createCarbonError<
  "ExternalServiceError",
  { service?: string }
>(
  "ExternalServiceError",
  msg({
    id: "error.externalService",
    message: "An external service is currently unavailable"
  })
) {}
