import { getEntry, type TermId } from "@carbon/glossary";
import {
  cn,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@carbon/react";
import type { ReactNode } from "react";
import { LuInfo } from "react-icons/lu";

/**
 * Docs base URL for the inline "Learn more" link. Hardcoded here rather than
 * exposed from `@carbon/glossary` because it's one constant with minimal drift
 * risk and exporting it would invite touching `docs/lib/seo.ts`.
 */
const DOCS_BASE_URL = "https://docs.carbon.ms";

type LabelWithHelpProps = {
  /**
   * Glossary term id. Typed as `TermId` so a typo at the call site is a compile
   * error. Pass `undefined` to render the label without the help affordance.
   */
  termId: TermId | undefined;
  /**
   * The visible label text — typically a string, but any ReactNode works
   * (Lingui `<Trans>`, emoji, etc.).
   */
  children: ReactNode;
  /**
   * Optional override for the tooltip body. When set, replaces `entry.definition`
   * so the call-site can inline interactive React Router `<Link>`s, modal
   * triggers, or other JSX. When set, the auto "Learn more" link is suppressed —
   * the override is expected to handle its own in-app routing.
   *
   * Note: Radix Tooltip's hoverable content keeps the tooltip open while the
   * cursor is inside it, so links/buttons inside the body are reachable for
   * mouse users. Keyboard/touch reach is degraded; if a field needs guaranteed
   * keyboard-reachable actions, render them as helper text next to the input,
   * not inside this tooltip.
   *
   * Example:
   *   description={
   *     <>An employee accountable for this center — when approvals are on,
   *        they sign off on spend.{" "}
   *        <Link to="../approvals" className="text-primary font-medium underline decoration-dashed underline-offset-4 hover:decoration-solid">
   *          Configure approvals
   *        </Link>.
   *     </>
   *   }
   */
  description?: ReactNode;
  className?: string;
  tooltipDelayDuration?: number;
};

/**
 * Renders a form label with a small info icon next to it. Hovering (or focusing)
 * the icon shows a lightweight tooltip with the term's one-sentence definition.
 * When the term has a docs anchor, "Learn more" is appended inline with a dashed
 * underline — same line as the definition, not a separate footer link.
 *
 * Screen-reader coverage is built in: a visually-hidden span sits inside the
 * label (alongside the visible text + icon). Because the whole `LabelWithHelp`
 * JSX is rendered inside the form field's `<FormLabel>`, the sr-only span lives
 * inside the label scope — so the SR reads the definition as part of the
 * accessible name when the associated input is focused, with no need for an
 * `aria-describedby` wiring at the call-site.
 *
 * When `termId` is undefined or unknown, renders the children alone — safe to
 * drop into a label slot whether or not the term is in the glossary.
 */
export function LabelWithHelp({
  termId,
  children,
  description,
  className,
  tooltipDelayDuration = 200
}: LabelWithHelpProps) {
  const entry = termId !== undefined ? getEntry(termId) : undefined;
  if (!entry) return <>{children}</>;

  // When the call-site provides a JSX override, it's responsible for any
  // in-app routing it wants to surface — auto-appending "Learn more" would
  // duplicate that or muddy the call-site's intent.
  const showLearnMore = description === undefined && entry.href !== undefined;

  return (
    <HStack spacing={1} className={cn("items-center", className)}>
      <span>{children}</span>
      <TooltipProvider delayDuration={tooltipDelayDuration}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`What is ${entry.term}?`}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LuInfo className="h-3.5 w-3.5" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            className="max-w-xs text-pretty leading-relaxed text-muted-foreground"
          >
            {description ?? entry.definition}
            {showLearnMore && (
              <>
                {" "}
                <a
                  href={`${DOCS_BASE_URL}${entry.href}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary font-medium underline decoration-dashed underline-offset-4 hover:decoration-solid"
                >
                  Learn more
                </a>
              </>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <span className="sr-only">{entry.definition}</span>
    </HStack>
  );
}
