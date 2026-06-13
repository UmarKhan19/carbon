import { msg } from "@lingui/core/macro";

/**
 * Approvals-specific error messages, authored next to the service that raises
 * them. They are passed as call-site descriptor overrides to the core errors
 * (ConflictError / BusinessRuleError), so the wording lives with the code while
 * the error taxonomy stays in the closed core set.
 */

/** An approval decision was attempted on a request that is no longer pending. */
export const approvalNotPendingMessage = msg({
  id: "approvals.notPending",
  message: "Approval request is not pending"
});

/** Someone other than the original requester tried to cancel the request. */
export const onlyRequesterCanCancelMessage = msg({
  id: "approvals.onlyRequesterCanCancel",
  message: "Only the requester can cancel an approval request"
});
