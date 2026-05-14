import { Button, HStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

type ReorderEditBarProps = {
  isSaving: boolean;
  isDirty: boolean;
  onSave: () => void;
  onCancel: () => void;
};

/**
 * Two-button strip (Cancel / Save) shown above the explorer's primary footer
 * action while drag-to-reorder is active. Same h-8 chrome as the trigger
 * Button it replaces, so the explorer doesn't shift between states.
 */
export function ReorderEditBar({
  isSaving,
  isDirty,
  onSave,
  onCancel
}: ReorderEditBarProps) {
  return (
    <HStack spacing={2} className="w-full">
      <Button
        variant="secondary"
        className="flex-1"
        isDisabled={isSaving}
        onClick={onCancel}
      >
        <Trans>Cancel</Trans>
      </Button>
      <Button
        variant="primary"
        className="flex-1"
        isDisabled={!isDirty || isSaving}
        isLoading={isSaving}
        onClick={onSave}
      >
        <Trans>Save</Trans>
      </Button>
    </HStack>
  );
}
