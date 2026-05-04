import { toast } from "@carbon/react";
import type { Violation } from "@carbon/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import ItemRuleViolationModal from "~/components/ItemRuleViolationModal";

/**
 * Shape every item-rule-aware server action must return when it wants the
 * client to surface violations. Mirrors the payload produced by
 * `evaluateForItem` + the per-action wrapper that resolves rule names.
 */
export type ItemRuleViolationPayload = {
  error?: { message?: string } | null;
  data?: unknown;
  violations?: Violation[];
  ruleNames?: Record<string, string>;
};

type UseItemRuleViolationsOptions = {
  /** Server action endpoint that the form is posted to. */
  action: string;
  /**
   * Optional callback fired once a submission resolves with no violations
   * and no error — i.e. the operation actually succeeded.
   */
  onSuccess?: () => void;
};

type UseItemRuleViolationsResult<T> = {
  // `useFetcher<T>` actually returns `FetcherWithComponents<SerializeFrom<T>>`;
  // mirror that here so callers see the serialised payload type without us
  // having to import the React Router internal `SerializeFrom` helper.
  fetcher: ReturnType<typeof useFetcher<T>>;
  /** Submit a form. Captures the FormData so acknowledge can re-post it. */
  submit: (formData: FormData) => void;
  /**
   * Render this somewhere in your component to surface violations. Returns
   * `null` when there's nothing to show.
   */
  ViolationModal: () => JSX.Element | null;
};

/**
 * Centralised handler for item rule violations + action errors.
 *
 * Wraps a `useFetcher` and:
 * - toasts any `error.message` returned by the action
 * - opens `<ItemRuleViolationModal>` when the action returns `violations`
 * - re-posts the last form data with `acknowledged=true` when the user
 *   clicks "Acknowledge & continue"
 * - resets the dismissed/ack flags on every fresh submission
 *
 * Call sites only have to swap `fetcher.submit(...)` for `rules.submit(...)`
 * and render `<rules.ViolationModal />`. Everything else is wired internally.
 */
export function useItemRuleViolations<T = unknown>({
  action,
  onSuccess
}: UseItemRuleViolationsOptions): UseItemRuleViolationsResult<T> {
  const fetcher = useFetcher<T>();
  const lastSubmissionRef = useRef<FormData | null>(null);
  // Tracks whether a submission was issued but onSuccess hasn't fired yet.
  // Server actions that respond with `throw redirect(...)` leave
  // `fetcher.data` undefined after the request settles, so we can't rely on
  // `data` alone to detect "operation succeeded".
  const pendingSuccessRef = useRef(false);
  const [dismissed, setDismissed] = useState(false);

  const data = fetcher.data as ItemRuleViolationPayload | undefined;
  const errorMessage = data?.error?.message;
  // Only trust the payload once the fetcher has settled. While a request is
  // in-flight `fetcher.data` still holds the *previous* response — reading
  // it would briefly re-show stale violations between the user clicking
  // submit and the new response arriving (the visible "flash"). Gate the
  // surfaced state on `idle` so the modal stays put with the last good
  // payload until the new one is committed.
  const idle = fetcher.state === "idle";
  const violations = idle ? (data?.violations ?? []) : [];
  const ruleNames = idle ? data?.ruleNames : undefined;
  const hasViolations = violations.length > 0 && !dismissed;

  // Toast any non-violation server error.
  useEffect(() => {
    if (!idle) return;
    if (errorMessage) toast.error(errorMessage);
  }, [idle, errorMessage]);

  // Fire onSuccess when a submission settles cleanly. Trigger from the
  // pending flag (set on submit, cleared after firing) so it works for both
  // JSON-returning actions and ones that respond with `throw redirect(...)`
  // — the latter leave `fetcher.data` undefined when settled.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onSuccess identity is intentionally not tracked
  useEffect(() => {
    if (!idle) return;
    if (!pendingSuccessRef.current) return;
    if (errorMessage) return;
    if ((data?.violations ?? []).length > 0) return;
    pendingSuccessRef.current = false;
    onSuccess?.();
  }, [idle, data, errorMessage]);

  const submit = useCallback(
    (formData: FormData) => {
      lastSubmissionRef.current = formData;
      // Reset the dismiss flag synchronously so the next response opens the
      // modal even if the previous one was dismissed without new violations.
      setDismissed(false);
      pendingSuccessRef.current = true;
      fetcher.submit(formData, { method: "post", action });
    },
    [fetcher, action]
  );

  const acknowledge = useCallback(() => {
    if (!lastSubmissionRef.current) return;
    const formData = new FormData();
    for (const [k, v] of lastSubmissionRef.current.entries()) {
      formData.append(k, v as string);
    }
    formData.set("acknowledged", "true");
    setDismissed(false);
    pendingSuccessRef.current = true;
    fetcher.submit(formData, { method: "post", action });
  }, [fetcher, action]);

  const cancel = useCallback(() => setDismissed(true), []);

  const ViolationModal = useCallback(() => {
    if (!hasViolations) return null;
    return (
      <ItemRuleViolationModal
        violations={violations}
        ruleNames={ruleNames}
        isSubmitting={!idle}
        onCancel={cancel}
        onAcknowledge={acknowledge}
      />
    );
  }, [hasViolations, violations, ruleNames, idle, cancel, acknowledge]);

  return { fetcher, submit, ViolationModal };
}
