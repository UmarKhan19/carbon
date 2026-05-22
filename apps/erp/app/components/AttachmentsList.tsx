import { useCarbon } from "@carbon/auth";
import {
  Badge,
  HStack,
  IconButton,
  Spinner,
  toast,
  VStack
} from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { LuCloudUpload, LuFileText, LuX } from "react-icons/lu";
import { useRevalidator } from "react-router";
import { useUser } from "~/hooks";
import { stripSpecialCharacters } from "~/utils/string";

export type ResolvedAttachmentItem = {
  source: "po" | "company" | "supplier" | "item";
  sourceLabel: string;
  name: string;
  size: number | null;
  /** Full storage path under the `private` bucket. Used as a stable key. */
  path: string;
};

type AttachmentsListProps = {
  /**
   * Supplier interaction id — used as the upload destination for ad-hoc files
   * dropped at finalize time. Files go to
   * `{companyId}/supplier-interaction/{supplierInteractionId}/` and are
   * auto-attached by the existing supplier-quote/RFQ flow conventions.
   */
  supplierInteractionId: string | null;
  /** Pinned, non-removable. Always sent. Used for the PO PDF preview row. */
  pinned?: Array<{ name: string; sizeKb?: number; label?: string }>;
  /** Resolved attachments (Company + Supplier + Item + PO ad-hoc). */
  attachments: ResolvedAttachmentItem[];
};

const WARN_KB = 20 * 1024;
const LIMIT_KB = 25 * 1024;

const sourceBadgeVariant: Record<
  ResolvedAttachmentItem["source"],
  "blue" | "green" | "orange" | "purple"
> = {
  po: "blue",
  item: "green",
  supplier: "orange",
  company: "purple"
};

/**
 * Read-only preview of every file that's about to ride along on a PO send,
 * plus a drag-drop zone for ad-hoc uploads. No selection UI — everything in
 * the four scope folders auto-attaches, matching the supplier-quote/RFQ flows.
 */
export default function AttachmentsList({
  supplierInteractionId,
  pinned = [],
  attachments
}: AttachmentsListProps) {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const revalidator = useRevalidator();
  const [uploading, setUploading] = useState(false);

  const totalKb = useMemo(() => {
    const pinnedKb = pinned.reduce((sum, p) => sum + (p.sizeKb ?? 0), 0);
    const attKb = attachments.reduce((sum, a) => sum + (a.size ?? 0), 0);
    return pinnedKb + attKb;
  }, [attachments, pinned]);

  const overLimit = totalKb > LIMIT_KB;
  const warning = totalKb > WARN_KB && !overLimit;

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!carbon) {
        toast.error(t`Storage client not available`);
        return;
      }
      if (!supplierInteractionId) {
        toast.error(t`Cannot upload — supplier interaction not yet created`);
        return;
      }
      setUploading(true);
      try {
        for (const file of acceptedFiles) {
          const safeName = stripSpecialCharacters(file.name);
          const storagePath = `${company.id}/supplier-interaction/${supplierInteractionId}/${safeName}`;
          const upload = await carbon.storage
            .from("private")
            .upload(storagePath, file, {
              cacheControl: `${12 * 60 * 60}`,
              upsert: true
            });
          if (upload.error) {
            toast.error(t`Failed to upload ${file.name}`);
          }
        }
        revalidator.revalidate();
      } finally {
        setUploading(false);
      }
    },
    [carbon, company.id, supplierInteractionId, revalidator, t]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true
  });

  const onRemovePoFile = useCallback(
    async (a: ResolvedAttachmentItem) => {
      if (!carbon) return;
      const result = await carbon.storage.from("private").remove([a.path]);
      if (result.error) {
        toast.error(result.error.message || t`Error removing file`);
      } else {
        revalidator.revalidate();
      }
    },
    [carbon, revalidator, t]
  );

  return (
    <VStack spacing={2} className="w-full">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">
        <Trans>Attachments</Trans>
      </div>

      <VStack spacing={1} className="w-full">
        {pinned.map((p) => (
          <HStack
            key={`pinned-${p.name}`}
            className="w-full justify-between border rounded-md px-3 py-2 bg-muted/30"
          >
            <HStack className="gap-2">
              <LuFileText className="flex-shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium truncate max-w-[200px]">
                {p.name}
              </span>
              <Badge variant="gray" className="flex-shrink-0">
                {p.label ?? t`PO PDF`}
              </Badge>
            </HStack>
            <span className="text-xs font-mono text-muted-foreground flex-shrink-0 ml-2 whitespace-nowrap">
              {p.sizeKb ? convertKbToString(p.sizeKb) : "--"}
            </span>
          </HStack>
        ))}

        {attachments.length === 0 && pinned.length === 0 && (
          <div className="text-sm text-muted-foreground italic px-3 py-2">
            <Trans>No attachments.</Trans>
          </div>
        )}

        {attachments.map((a) => (
          <HStack
            key={a.path}
            className="w-full justify-between border rounded-md px-3 py-2"
          >
            <HStack className="gap-2">
              <LuFileText className="flex-shrink-0 text-muted-foreground" />
              <span className="text-sm truncate max-w-[200px]">{a.name}</span>
              <Badge
                variant={sourceBadgeVariant[a.source]}
                className="flex-shrink-0"
              >
                {a.sourceLabel}
              </Badge>
            </HStack>
            <HStack className="gap-2 flex-shrink-0 ml-2">
              <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                {a.size != null ? convertKbToString(a.size) : "--"}
              </span>
              {a.source === "po" && (
                <IconButton
                  aria-label={t`Remove`}
                  icon={<LuX />}
                  size="sm"
                  variant="ghost"
                  onClick={() => onRemovePoFile(a)}
                />
              )}
            </HStack>
          </HStack>
        ))}
      </VStack>

      {/* Drag-and-drop — uploads to the supplier-interaction folder, which the
          send action automatically picks up. */}
      <div
        {...getRootProps()}
        className={`mt-2 w-full border-2 border-dashed rounded-md p-4 text-center cursor-pointer transition-colors ${
          isDragActive
            ? "border-primary bg-primary/10"
            : "border-muted hover:border-primary/50"
        }`}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner /> <Trans>Uploading…</Trans>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
            <LuCloudUpload className="h-6 w-6" />
            <Trans>Drag &amp; drop files, or click to browse</Trans>
          </div>
        )}
      </div>

      <div
        className={`w-full text-xs font-mono ${
          overLimit
            ? "text-destructive"
            : warning
              ? "text-amber-700"
              : "text-muted-foreground"
        }`}
      >
        {convertKbToString(totalKb)} / {convertKbToString(LIMIT_KB)}
        {overLimit && (
          <span className="ml-2">
            <Trans>
              Exceeds 25 MB total — remove some attachments to send.
            </Trans>
          </span>
        )}
        {warning && (
          <span className="ml-2">
            <Trans>Approaching 25 MB cap.</Trans>
          </span>
        )}
      </div>
    </VStack>
  );
}
