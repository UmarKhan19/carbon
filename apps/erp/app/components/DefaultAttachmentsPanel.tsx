import { useCarbon } from "@carbon/auth";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Spinner,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast
} from "@carbon/react";
import { convertKbToString } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import {
  LuCloudUpload,
  LuDownload,
  LuEllipsisVertical,
  LuLock,
  LuLockOpen,
  LuTrash
} from "react-icons/lu";
import { useFetcher, useRevalidator, useSubmit } from "react-router";
import DocumentIcon from "~/components/DocumentIcon";
import DocumentPreview from "~/components/DocumentPreview";
import { useDateFormatter, useUser } from "~/hooks";
import { getDocumentType } from "~/modules/shared";
import { path } from "~/utils/path";
import { stripSpecialCharacters } from "~/utils/string";

export type DefaultAttachment = {
  id: string;
  documentId: string;
  shareOnSend: boolean;
  isLocked: boolean;
  document: {
    name: string;
    size: number | null;
    path: string | null;
    createdAt: string | null;
  } | null;
};

type Props = {
  attachments: DefaultAttachment[];
  /** Where uploaded files are stored, relative to the company root. */
  storagePathPrefix: string;
  /** Action URL the metadata POSTs to after upload. */
  uploadAction: string;
  /** Builder for the per-attachment delete action URL. */
  deleteAction: (attachmentId: string) => string;
  /** Builder for the per-attachment lock-toggle action URL. */
  lockAction: (attachmentId: string) => string;
  /** Card title text. */
  title: ReactNode;
  /** Card description text. */
  description: ReactNode;
  /** Stable prefix for fetcherKey (avoids cross-panel collisions). */
  fetcherKeyPrefix: string;
};

const PREVIEWABLE = new Set(["PDF", "Image"]);

/**
 * Generic management UI for default attachments at any scope
 * (company / supplier / item). Drag-and-drop upload + list + per-row
 * download/delete actions, with hover preview for PDF/image.
 */
export default function DefaultAttachmentsPanel({
  attachments,
  storagePathPrefix,
  uploadAction,
  deleteAction,
  lockAction,
  title,
  description,
  fetcherKeyPrefix
}: Props) {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const { carbon } = useCarbon();
  const { company } = useUser();
  const revalidator = useRevalidator();
  const submit = useSubmit();
  const deleteFetcher = useFetcher();
  const lockFetcher = useFetcher();
  const [uploading, setUploading] = useState(false);

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
          const storagePath = `${company.id}/${storagePathPrefix}/${safeName}`;

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
            action: uploadAction,
            navigate: false,
            fetcherKey: `${fetcherKeyPrefix}:${safeName}`
          });
        }
        setTimeout(() => revalidator.revalidate(), 250);
      } finally {
        setUploading(false);
      }
    },
    [
      carbon,
      company.id,
      fetcherKeyPrefix,
      revalidator,
      storagePathPrefix,
      submit,
      t,
      uploadAction
    ]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true
  });

  const download = useCallback(
    async (file: { name: string; path: string }) => {
      const url = path.to.file.previewFile(`private/${file.path}`);
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        document.body.appendChild(a);
        a.href = blobUrl;
        a.download = file.name;
        a.click();
        window.URL.revokeObjectURL(blobUrl);
        document.body.removeChild(a);
      } catch (err) {
        toast.error(t`Error downloading file`);
        console.error(err);
      }
    },
    [t]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table className="w-full table-fixed">
          <Thead>
            <Tr>
              <Th className="w-auto">
                <Trans>Name</Trans>
              </Th>
              <Th className="w-24">
                <Trans>Size</Trans>
              </Th>
              <Th className="w-32">
                <Trans>Created</Trans>
              </Th>
              <Th className="w-12"></Th>
            </Tr>
          </Thead>
          <Tbody>
            {[...attachments]
              .sort((a, b) => {
                // Locked first, then by name for stable ordering.
                if (a.isLocked !== b.isLocked) return a.isLocked ? -1 : 1;
                const an = a.document?.name ?? "";
                const bn = b.document?.name ?? "";
                return an.localeCompare(bn);
              })
              .map((a) => {
                const doc = a.document;
                if (!doc) return null;
                const type = getDocumentType(doc.name);
                const isPreviewable = PREVIEWABLE.has(type);
                const filePath = doc.path ?? "";

                return (
                  <Tr key={a.id}>
                    <Td className="max-w-0">
                      <HStack className="gap-2 min-w-0 w-full">
                        <DocumentIcon type={type} />
                        <span
                          className="font-medium truncate cursor-pointer min-w-0 flex-1"
                          onClick={() => {
                            if (isPreviewable && filePath) {
                              window.open(
                                path.to.file.previewFile(`private/${filePath}`),
                                "_blank"
                              );
                            } else if (filePath) {
                              download({ name: doc.name, path: filePath });
                            }
                          }}
                        >
                          {isPreviewable && filePath ? (
                            <DocumentPreview
                              bucket="private"
                              pathToFile={filePath}
                              // @ts-ignore — type is a string union the preview accepts
                              type={type}
                            >
                              {doc.name}
                            </DocumentPreview>
                          ) : (
                            doc.name
                          )}
                        </span>
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
                    </Td>
                    <Td className="text-xs font-mono whitespace-nowrap">
                      {doc.size ? convertKbToString(doc.size) : "--"}
                    </Td>
                    <Td className="text-xs font-mono whitespace-nowrap">
                      {doc.createdAt ? formatDate(doc.createdAt) : "--"}
                    </Td>
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
                            <DropdownMenuItem
                              disabled={lockFetcher.state !== "idle"}
                              onClick={() =>
                                lockFetcher.submit(
                                  { locked: a.isLocked ? "false" : "true" },
                                  {
                                    method: "post",
                                    action: lockAction(a.id)
                                  }
                                )
                              }
                            >
                              <DropdownMenuIcon
                                icon={a.isLocked ? <LuLockOpen /> : <LuLock />}
                              />
                              {a.isLocked ? (
                                <Trans>Unlock</Trans>
                              ) : (
                                <Trans>Lock</Trans>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!filePath}
                              onClick={() =>
                                filePath &&
                                download({ name: doc.name, path: filePath })
                              }
                            >
                              <DropdownMenuIcon icon={<LuDownload />} />
                              <Trans>Download</Trans>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              destructive
                              disabled={
                                a.isLocked || deleteFetcher.state !== "idle"
                              }
                              onClick={() =>
                                deleteFetcher.submit(
                                  {},
                                  {
                                    method: "post",
                                    action: deleteAction(a.id)
                                  }
                                )
                              }
                            >
                              <DropdownMenuIcon icon={<LuTrash />} />
                              <Trans>Delete</Trans>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            {attachments.length === 0 && (
              <Tr>
                <Td
                  colSpan={4}
                  className="py-8 text-muted-foreground text-center"
                >
                  <Trans>No default attachments yet.</Trans>
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>

        <div
          {...getRootProps()}
          className={`mt-4 w-full border-2 border-dashed rounded-md p-4 text-center cursor-pointer transition-colors ${
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
      </CardContent>
    </Card>
  );
}
