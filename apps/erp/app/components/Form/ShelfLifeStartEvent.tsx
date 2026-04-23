import { useControlField } from "@carbon/form";
import {
  cn,
  FormControl,
  FormLabel,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import Process from "./Process";

// Single composite control for configuring when shelf life starts stamping.
// Visually one field with a shared label across both segments: a PRE/POST
// pill toggle on the left + the Process combobox on the right, rendered
// as a single segmented control. The pill is always visible (defaulting
// to PRE); timing is only semantically meaningful when a process is also
// chosen, but the DB carries 'After' as its default so submitting PRE
// without a process is a harmless no-op at the interceptor layer.
type Props = {
  /** Form field name for the trigger process id (TEXT). */
  processName: string;
  /** Form field name for the trigger timing ('Before' | 'After'). */
  timingName: string;
  label: string;
};

type Timing = "Before" | "After";

const ShelfLifeStartEvent = ({ processName, timingName, label }: Props) => {
  const { t } = useLingui();
  const [timing, setTiming] = useControlField<Timing | undefined>(timingName);

  const current: Timing = timing ?? "Before";
  const flip = () => setTiming(current === "Before" ? "After" : "Before");

  return (
    <FormControl>
      <FormLabel isOptional>{label}</FormLabel>

      <div
        className={cn(
          "flex items-stretch",
          // Strip the combobox trigger's left rounding + left border so
          // the pill and combobox read as a single segmented control.
          "[&_[role=combobox]]:rounded-l-none [&_[role=combobox]]:border-l-0"
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={flip}
              aria-label={
                current === "Before"
                  ? t`Stamp expiry before process starts`
                  : t`Stamp expiry after process completes`
              }
              className="shrink-0 h-10 px-3 rounded-l-md border border-r-0 border-input bg-muted/60 text-xs font-semibold tracking-wider text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {current === "Before" ? "PRE" : "POST"}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {current === "Before"
              ? t`Stamp expiry before process starts`
              : t`Stamp expiry after process completes`}
          </TooltipContent>
        </Tooltip>

        <div className="flex-1 min-w-0">
          <Process name={processName} label="" />
        </div>
      </div>

      <input type="hidden" name={timingName} value={current} />
    </FormControl>
  );
};

export default ShelfLifeStartEvent;
