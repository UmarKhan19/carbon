import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Label,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuCirclePlus, LuX } from "react-icons/lu";

export type StepPart = {
  id: string;
  name: string;
  quantity: number;
};

// Step-side Parts picker: assign the operation's BOM parts to a step (the inverse of the old
// BOM "Steps" dropdown). Presentational — the caller owns the linked set and persists changes
// (immediately via a route for saved steps, or a draft buffer for a step being created). Used
// by both the item method editor (BillOfProcess) and the job editor (JobBillOfProcess).
export function StepPartsEditor({
  parts,
  linkedPartIds,
  isDisabled,
  busy,
  onAdd,
  onRemove
}: {
  parts: StepPart[];
  linkedPartIds: string[];
  isDisabled: boolean;
  busy?: boolean;
  onAdd: (partId: string) => void;
  onRemove: (partId: string) => void;
}) {
  const { t } = useLingui();

  const linkedSet = new Set(linkedPartIds);
  const linked = parts.filter((p) => linkedSet.has(p.id));
  const available = parts.filter((p) => !linkedSet.has(p.id));

  if (isDisabled && linked.length === 0) return null;

  return (
    <VStack spacing={2} className="w-full col-span-2 border-t pt-4">
      <div className="flex w-full items-center justify-between">
        <Label className="text-xs text-muted-foreground">{t`Parts`}</Label>
        {!isDisabled && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<LuCirclePlus />}
                isLoading={busy}
                isDisabled={busy || available.length === 0}
              >
                {t`Add parts`}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-64 overflow-y-auto">
              {available.map((part) => (
                <DropdownMenuItem
                  key={part.id}
                  onSelect={() => onAdd(part.id)}
                  className="flex items-center justify-between gap-4"
                >
                  <span className="truncate">{part.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    ×{part.quantity}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {linked.length === 0 ? (
        <p className="w-full text-xs text-muted-foreground">{t`No parts`}</p>
      ) : (
        <div className="flex w-full flex-col gap-2">
          {linked.map((part) => (
            <div
              key={part.id}
              className="flex items-center gap-3 rounded-lg border px-3 py-2"
            >
              <span className="size-2 shrink-0 rounded-full bg-muted-foreground/40" />
              <span className="min-w-0 flex-1 truncate text-sm">
                {part.name}
              </span>
              <span className="shrink-0 rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
                ×{part.quantity}
              </span>
              {!isDisabled && (
                <IconButton
                  aria-label={t`Remove part`}
                  icon={<LuX />}
                  variant="secondary"
                  size="sm"
                  isDisabled={busy}
                  onClick={() => onRemove(part.id)}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </VStack>
  );
}
