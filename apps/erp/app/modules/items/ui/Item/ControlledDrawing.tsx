import { FormControl, FormLabel } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import { Hyperlink } from "~/components";
import type { ControlledDrawing } from "~/modules/items/items.service";
import { path } from "~/utils/path";

export function useItemControlledDrawing(
  itemId: string | null | undefined
): ControlledDrawing | null {
  const fetcher = useFetcher<{ controlledDrawing: ControlledDrawing | null }>();
  const load = fetcher.load;

  useEffect(() => {
    if (itemId) {
      load(`${path.to.api.itemDrawing}?itemId=${itemId}`);
    }
  }, [itemId, load]);

  return itemId ? (fetcher.data?.controlledDrawing ?? null) : null;
}

export function ControlledDrawingLink({
  drawing
}: {
  drawing: ControlledDrawing | null;
}) {
  if (!drawing) return null;

  return (
    <FormControl>
      <FormLabel>
        <Trans>Controlled Drawing</Trans>
      </FormLabel>
      <Hyperlink
        target="_blank"
        to={path.to.file.previewFile(`private/${drawing.drawingPath}`)}
      >
        {drawing.drawingRevisionLabel ? (
          <Trans>Drawing (Rev {drawing.drawingRevisionLabel})</Trans>
        ) : (
          <Trans>Drawing</Trans>
        )}
      </Hyperlink>
    </FormControl>
  );
}
