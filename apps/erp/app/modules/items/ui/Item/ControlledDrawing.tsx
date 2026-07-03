import { useCarbon } from "@carbon/auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  File,
  FormControl,
  FormLabel,
  HStack,
  IconButton,
  Td,
  Tr,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import type { ChangeEvent } from "react";
import { useCallback, useEffect } from "react";
import { LuEllipsisVertical, LuFileText } from "react-icons/lu";
import { Link, useFetcher, useRevalidator, useSubmit } from "react-router";
import { Hyperlink } from "~/components";
import { usePermissions, useUser } from "~/hooks";
import type { ControlledDrawing } from "~/modules/items/items.service";
import { path } from "~/utils/path";

export function useItemControlledDrawing(
  itemId: string | null | undefined
): ControlledDrawing | null {
  const fetcher = useFetcher<{
    itemId: string | null;
    controlledDrawing: ControlledDrawing | null;
  }>();
  const load = fetcher.load;

  useEffect(() => {
    if (itemId) {
      load(`${path.to.api.itemDrawing}?itemId=${itemId}`);
    }
  }, [itemId, load]);

  // Gate on the fetched itemId so a re-picked item never briefly shows the
  // previous item's drawing while its own fetch is in flight.
  return itemId && fetcher.data?.itemId === itemId
    ? fetcher.data.controlledDrawing
    : null;
}

// Manual writer of the controlled-drawing slot: the PDF is uploaded client-side
// to the private bucket, then its path is posted to the item.drawing route,
// which records it (drawingSource: "manual") in the `drawing`
// externalIntegrationMapping metadata that every reader keys on.
export function useControlledDrawingMutations(itemId: string) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const revalidator = useRevalidator();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const submit = useSubmit();

  const canUpdate = permissions.can("update", "parts");

  const uploadDrawing = useCallback(
    async (file: File) => {
      if (!carbon) {
        toast.error(t`Carbon client not available`);
        return;
      }

      toast.info(t`Uploading ${file.name}`);
      const drawingPath = `${company.id}/models/${nanoid()}.pdf`;
      const upload = await carbon.storage
        .from("private")
        .upload(drawingPath, file, {
          cacheControl: `${12 * 60 * 60}`,
          upsert: true,
          contentType: "application/pdf"
        });

      if (upload.error) {
        toast.error(t`Failed to upload drawing: ${file.name}`);
        return;
      }

      const formData = new FormData();
      formData.append("intent", "upload");
      formData.append("itemId", itemId);
      formData.append("drawingPath", drawingPath);

      submit(formData, {
        method: "post",
        action: path.to.api.itemDrawing,
        navigate: false,
        fetcherKey: `drawing:${itemId}`
      });
      toast.success(t`Controlled drawing uploaded`);
      revalidator.revalidate();
    },
    [carbon, company.id, itemId, submit, revalidator, t]
  );

  const removeDrawing = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "remove");
    formData.append("itemId", itemId);

    submit(formData, {
      method: "post",
      action: path.to.api.itemDrawing,
      navigate: false,
      fetcherKey: `drawing:${itemId}`
    });
    revalidator.revalidate();
  }, [itemId, submit, revalidator]);

  return { canUpdate, uploadDrawing, removeDrawing };
}

export function ControlledDrawingUpload({ itemId }: { itemId: string }) {
  const { canUpdate, uploadDrawing } = useControlledDrawingMutations(itemId);

  const onChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await uploadDrawing(file);
    }
    e.target.value = "";
  };

  return (
    <File
      isDisabled={!canUpdate}
      leftIcon={<LuFileText />}
      accept="application/pdf"
      onChange={onChange}
    >
      Drawing
    </File>
  );
}

export function ControlledDrawingRow({
  itemId,
  drawing
}: {
  itemId: string;
  drawing: ControlledDrawing | null | undefined;
}) {
  const { t } = useLingui();
  const { canUpdate, removeDrawing } = useControlledDrawingMutations(itemId);

  if (!drawing) return null;

  const previewPath = path.to.file.previewFile(
    `private/${drawing.drawingPath}`
  );

  return (
    <Tr>
      <Td>
        <HStack>
          <LuFileText className="text-blue-500 w-6 h-6" />
          <Hyperlink target="_blank" to={previewPath}>
            {drawing.drawingRevisionLabel
              ? t`Controlled Drawing (Rev ${drawing.drawingRevisionLabel})`
              : t`Controlled Drawing`}
          </Hyperlink>
        </HStack>
      </Td>
      <Td className="text-xs font-mono">--</Td>
      <Td className="text-xs font-mono">--</Td>
      <Td>
        <div className="flex justify-end w-full">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={t`More`}
                icon={<LuEllipsisVertical />}
                variant="secondary"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem asChild>
                <Link target="_blank" to={previewPath}>
                  <Trans>View</Trans>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                destructive
                disabled={!canUpdate}
                onClick={() => removeDrawing()}
              >
                <Trans>Remove</Trans>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Td>
    </Tr>
  );
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
