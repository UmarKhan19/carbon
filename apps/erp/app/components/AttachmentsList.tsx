import { useCarbon } from "@carbon/auth";
import {
  Badge,
  Checkbox,
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
import { LuCloudUpload, LuFileText, LuLock, LuX } from "react-icons/lu";
import { useFetcher, useRevalidator, useSubmit } from "react-router";
import { useUser } from "~/hooks";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

export type ResolvedAttachmentItem = {
  documentId: string;
  /** When source === "po", the id of the purchaseOrderAttachment row (for delete). */
  attachmentRowId: string | null;
  source: "po" | "company" | "supplier" | "item";
  sourceLabel: string;
  shareOnSend: boolean;
  isLocked: boolean;
  name: string;
  size: number | null;
};

type AttachmentsListProps = {
  purchaseOrderId: string;
  /** Pinned, non-removable. Always sent regardless of selection state. */
  pinned?: Array<{ name: string; sizeKb?: number; label?: string }>;
  /** Resolved attachments (Company + Supplier + Item + PO ad-hoc, deduped). */
  attachments: ResolvedAttachmentItem[];
  /** Form field name for the hidden inputs carrying included documentIds. */
  fieldName?: string;
};

const WARN_KB = 20 * 1024;
const LIMIT_KB = 25 * 1024;

// Map of attachment source → Carbon Badge variant. Uses built-in semantic
// color variants from packages/react/src/Badge.tsx so dark mode + the
// rest of the design system stays consistent. Do not introduce custom
// `bg-*`/`text-*` Tailwind classes for status colors here.
const sourceBadgeVariant: Record<
  ResolvedAttachmentItem["source"],
  "blue" | "green" | "orange" | "purple"
> = {
  po: "blue",
  item: "green",
  supplier: "orange",
  company: "purple"
};

export default function AttachmentsList({
  purchaseOrderId,
  pinned = [],
  attachments,
  fieldName = "attachmentDocumentIds"
}: AttachmentsListProps) {
  const { t } = useLingui();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const revalidator = useRevalidator();
  const submit = useSubmit();
  const [uploading, setUploading] = useState(false);

  // Track which document IDs the user has explicitly excluded for THIS send.
  // Default: all shareOnSend=true items are included; shareOnSend=false items
  // are visible-but-greyed-out and never selectable for this send.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  // Locked attachments cannot be excluded — they're always included if shareOnSend=true.
  const isIncluded = (a: ResolvedAttachmentItem) =>
    a.shareOnSend && (a.isLocked || !excluded.has(a.documentId));

  const includedIds = useMemo(() => {
    return attachments.filter(isIncluded).map((a) => a.documentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments, excluded]);

  const totalKb = useMemo(() => {
    const pinnedKb = pinned.reduce((sum, p) => sum + (p.sizeKb ?? 0), 0);
    const attKb = attachments
      .filter(isIncluded)
      .reduce((sum, a) => sum + (a.size ?? 0), 0);
    return pinnedKb + attKb;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments, excluded, pinned]);

  const overLimit = totalKb > LIMIT_KB;
  const warning = totalKb > WARN_KB && !overLimit;

  const toggle = (docId: string, checked: boolean) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!carbon) {
        toast.error(t`Storage client not available`);
        return;
      }
      setUploading(true);
      try {
        for (const file of acceptedFiles) {
          const safeName = stripSpecialCharacters(file.name);
          const storagePath = `${company.id}/purchase-order/${purchaseOrderId}/${safeName}`;

          const upload = await carbon.storage
            .from("private")
            .upload(storagePath, file, {
              cacheControl: `${12 * 60 * 60}`,
              upsert: true
            });

          if (upload.error) {
            toast.error(t`Failed to upload ${file.name}`);
            continue;
          }

          const fd = new FormData();
          fd.append("path", storagePath);
          fd.append("name", file.name);
          fd.append("size", Math.round(file.size / 1024).toString());

          submit(fd, {
            method: "post",
            action: path.to.purchaseOrderAttachments(purchaseOrderId),
            navigate: false,
            fetcherKey: `po-att:${purchaseOrderId}:${safeName}`
          });
        }
        // Revalidate to pick up new server-side rows
        setTimeout(() => revalidator.revalidate(), 250);
      } finally {
        setUploading(false);
      }
    },
    [carbon, company.id, purchaseOrderId, revalidator, submit, t]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true
  });

  return (
    <VStack spacing={2} className="w-full">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">
        <Trans>Attachments</Trans>
      </div>

      <VStack spacing={1} className="w-full">
        {/* Pinned items: always sent */}
        {pinned.map((p) => (
          <HStack
            key={`pinned-${p.name}`}
            className="w-full justify-between border rounded-md px-3 py-2 bg-muted/30"
          >
            <HStack className="gap-2">
              <Checkbox checked disabled />
              <LuFileText className="text-muted-foreground" />
              <span className="text-sm font-medium truncate max-w-[260px]">
                {p.name}
              </span>
              <Badge variant="gray">{p.label ?? t`PO PDF`}</Badge>
            </HStack>
            <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
              {p.sizeKb ? convertKbToString(p.sizeKb) : "--"}
            </span>
          </HStack>
        ))}

        {/* Cascaded + ad-hoc attachments */}
        {attachments.length === 0 && pinned.length === 0 && (
          <div className="text-sm text-muted-foreground italic px-3 py-2">
            <Trans>No attachments yet.</Trans>
          </div>
        )}
        {[...attachments]
          .sort((a, b) => {
            // Sort priority:
            //   1. Locked first (mandatory attachments float to top)
            //   2. Source: Company → Supplier → Item → PO (broadest-scope first,
            //      most-specific last). Within each, alphabetical by name.
            if (a.isLocked !== b.isLocked) return a.isLocked ? -1 : 1;
            const sourceRank: Record<ResolvedAttachmentItem["source"], number> =
              {
                company: 0,
                supplier: 1,
                item: 2,
                po: 3
              };
            if (a.source !== b.source)
              return sourceRank[a.source] - sourceRank[b.source];
            return a.name.localeCompare(b.name);
          })
          .map((a) => {
            const included = isIncluded(a);
            return (
              <HStack
                key={a.documentId}
                className={`w-full justify-between border rounded-md px-3 py-2 ${
                  a.shareOnSend ? "" : "opacity-50"
                }`}
              >
                <HStack className="gap-2">
                  <Checkbox
                    checked={included}
                    disabled={!a.shareOnSend || a.isLocked}
                    onCheckedChange={(c) => toggle(a.documentId, c === true)}
                  />
                  <LuFileText className="text-muted-foreground" />
                  <span className="text-sm truncate max-w-[200px]">
                    {a.name}
                  </span>
                  <Badge variant={sourceBadgeVariant[a.source]}>
                    {a.sourceLabel}
                  </Badge>
                  {a.isLocked && (
                    <LuLock
                      className="w-3 h-3 text-amber-600"
                      aria-label={t`Locked`}
                    />
                  )}
                  {!a.shareOnSend && (
                    <Badge variant="secondary">
                      <Trans>Internal only</Trans>
                    </Badge>
                  )}
                </HStack>
                <HStack className="gap-2">
                  <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                    {a.size ? convertKbToString(a.size) : "--"}
                  </span>
                  {a.source === "po" && a.attachmentRowId && !a.isLocked && (
                    <DeletePoAttachmentButton
                      purchaseOrderId={purchaseOrderId}
                      attachmentRowId={a.attachmentRowId}
                    />
                  )}
                </HStack>
              </HStack>
            );
          })}

        {/* Hidden inputs carrying the included document IDs to the form action */}
        {includedIds.map((id, i) => (
          <input
            key={id}
            type="hidden"
            name={`${fieldName}[${i}]`}
            value={id}
          />
        ))}
      </VStack>

      {/* Drag-and-drop */}
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

      {/* Size meter */}
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

function DeletePoAttachmentButton({
  purchaseOrderId,
  attachmentRowId
}: {
  purchaseOrderId: string;
  attachmentRowId: string;
}) {
  const fetcher = useFetcher<{ success: boolean }>();
  const { t } = useLingui();

  return (
    <IconButton
      aria-label={t`Remove`}
      icon={<LuX />}
      size="sm"
      variant="ghost"
      isDisabled={fetcher.state !== "idle"}
      onClick={() =>
        fetcher.submit(
          {},
          {
            method: "post",
            action: path.to.purchaseOrderAttachmentDelete(
              purchaseOrderId,
              attachmentRowId
            )
          }
        )
      }
    />
  );
}
