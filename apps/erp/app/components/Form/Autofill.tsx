import { CreatableCombobox } from "@carbon/form";
import {
  Button,
  HStack,
  IconButton,
  Status,
  toast,
  useCarbon,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  LuCircleCheck,
  LuListPlus,
  LuLoaderCircle,
  LuMoveRight,
  LuSparkles,
  LuTriangleAlert
} from "react-icons/lu";
import { useFetcher } from "react-router";
import FileDropzone from "~/components/FileDropzone";
import {
  buildOptionLookup,
  type MatchableOption,
  matchCsvValue
} from "~/components/ImportCSVModal/enumMatch";
import { useUser } from "~/hooks";
import { useDocumentExtraction } from "~/hooks/useDocumentExtraction";
import {
  type AutofillDocumentType,
  type AutofillResolution,
  fetchEntityOptions,
  resolveAutofill,
  resolveChildren,
  type UnmatchedEntity
} from "~/modules/documents/autofill";
import { path } from "~/utils/path";
import { CreateEntityForm } from "./CreateEntityForm";
import { PdfReviewViewer } from "./PdfReviewViewer";

export type AutofillResult = {
  values: AutofillResolution["values"];
  lineItems: unknown[];
  storagePath?: string;
};

type AutofillProps = {
  documentType: AutofillDocumentType;
  sourceDocument: string;
  sourceDocumentId?: string;
  onApply: (result: AutofillResult) => void;
};

type Phase =
  | "drop"
  | "uploading"
  | "extracting"
  | "resolving"
  | "review"
  | "failed";

/** A row's create key — how we re-match a record the user just created. */
function matchKeyFor(entity: UnmatchedEntity): string | undefined {
  const p = entity.prefill;
  if (entity.kind === "supplier" || entity.kind === "customer")
    return p.name as string | undefined;
  if (entity.kind.endsWith("Contact"))
    return (
      (p.email as string) ||
      [p.firstName, p.lastName].filter(Boolean).join(" ") ||
      undefined
    );
  return p.addressLine1 as string | undefined;
}

const isParent = (k: UnmatchedEntity["kind"]) =>
  k === "supplier" || k === "customer";

/** 3-band confidence policy (mirrors the server gate at 0.85). */
function confidenceBand(c: number): {
  color: "green" | "yellow" | "red";
  label: string;
} {
  if (c >= 0.95) return { color: "green", label: "High" };
  if (c >= 0.85) return { color: "yellow", label: "Review" };
  return { color: "red", label: "Low" };
}

const humanize = (key: string) =>
  key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();

type ReviewRow = {
  key: string;
  label: string;
  value: string;
  confidence: number;
};

/** Build the per-field confidence review list from the raw AI output. */
function reviewRows(
  extractedData: Record<string, unknown> | null
): ReviewRow[] {
  if (!extractedData) return [];
  const rows: ReviewRow[] = [];
  for (const [key, v] of Object.entries(extractedData)) {
    if (key === "lineItems") continue;
    if (v && typeof v === "object" && "confidence" in v) {
      const f = v as { value: unknown; confidence: number };
      if (f.value !== null && f.value !== undefined && f.value !== "")
        rows.push({
          key,
          label: humanize(key),
          value: String(f.value),
          confidence: f.confidence
        });
    }
  }
  return rows;
}

export function Autofill({
  documentType,
  sourceDocument,
  sourceDocumentId,
  onApply
}: AutofillProps) {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const drawer = useDisclosure();
  const fetcher = useFetcher<{ extractionId?: string }>();

  const [phase, setPhase] = useState<Phase>("drop");
  const [error, setError] = useState<string>();
  const [extractionId, setExtractionId] = useState<string | null>(null);
  const [uploadedPath, setUploadedPath] = useState<string>();
  const [resolution, setResolution] = useState<AutofillResolution | null>(null);
  // user map/create selections by form field, seeded from auto-matches
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [optionsByField, setOptionsByField] = useState<
    Record<string, MatchableOption[]>
  >({});
  const [creating, setCreating] = useState<UnmatchedEntity | null>(null);
  // the extracted value currently highlighted on the PDF (click-to-source)
  const [activeHighlight, setActiveHighlight] = useState<string>();
  // raw extracted payload, kept so we can re-resolve children after a parent create
  const extractedRef = useRef<Record<string, any> | null>(null);

  const { extraction } = useDocumentExtraction(extractionId);

  const reset = useCallback(() => {
    setPhase("drop");
    setError(undefined);
    setExtractionId(null);
    setUploadedPath(undefined);
    setResolution(null);
    setSelected({});
    setOptionsByField({});
    setCreating(null);
    setActiveHighlight(undefined);
    extractedRef.current = null;
  }, []);

  const close = useCallback(() => {
    drawer.onClose();
    reset();
  }, [drawer, reset]);

  const applyAndClose = useCallback(
    (res: AutofillResolution, overrides: Record<string, string>) => {
      onApply({
        values: { ...res.values, ...overrides },
        lineItems: res.lineItems,
        storagePath: res.storagePath
      });
      toast.success("Fields populated from PDF. Please review before saving.");
      close();
    },
    [onApply, close]
  );

  const handleDrop = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file || !file.name.toLowerCase().endsWith(".pdf") || !carbon) return;

      setPhase("uploading");
      extractedRef.current = null;
      const storagePath = `${company.id}/extractions/${Date.now()}_${file.name}`;
      const { error: uploadError } = await carbon.storage
        .from("private")
        .upload(storagePath, file);

      if (uploadError) {
        setError("Failed to upload PDF.");
        setPhase("failed");
        return;
      }
      setUploadedPath(storagePath);

      const formData = new FormData();
      formData.append("storagePath", storagePath);
      formData.append("documentType", documentType);
      formData.append("sourceDocument", sourceDocument);
      if (sourceDocumentId)
        formData.append("sourceDocumentId", sourceDocumentId);
      fetcher.submit(formData, {
        method: "post",
        action: "/api/document-extraction"
      });
      setPhase("extracting");
    },
    [
      carbon,
      company.id,
      documentType,
      sourceDocument,
      sourceDocumentId,
      fetcher
    ]
  );

  // capture the extraction id from the action response
  useEffect(() => {
    if (fetcher.data?.extractionId && !extractionId) {
      setExtractionId(fetcher.data.extractionId);
    }
  }, [fetcher.data, extractionId]);

  // react to extraction terminal states
  useEffect(() => {
    if (!extraction || phase !== "extracting") return;
    if (extraction.status === "failed") {
      setError(extraction.error ?? "Extraction failed.");
      setPhase("failed");
      return;
    }
    if (
      extraction.status === "completed" &&
      extraction.filteredData &&
      carbon
    ) {
      setPhase("resolving");
      const data = {
        ...extraction.filteredData,
        _storagePath: extraction.storagePath
      };
      extractedRef.current = data;
      resolveAutofill(carbon, documentType, data)
        .then((res) => {
          setResolution(res);
          setOptionsByField(
            Object.fromEntries(res.unmatched.map((u) => [u.field, u.options]))
          );
          setPhase("review");
        })
        .catch(() => {
          setError("Could not match extracted values.");
          setPhase("failed");
        });
    }
  }, [extraction, phase, carbon, documentType]);

  const onCreated = useCallback(
    async (entity: UnmatchedEntity) => {
      if (!carbon) return;
      const options = await fetchEntityOptions(
        carbon,
        entity.kind,
        entity.parentId
      );
      setOptionsByField((prev) => ({ ...prev, [entity.field]: options }));
      const key = matchKeyFor(entity);
      const newId = key
        ? matchCsvValue(buildOptionLookup(options), key)
        : undefined;
      if (newId) setSelected((prev) => ({ ...prev, [entity.field]: newId }));
      setCreating(null);

      // Dependency ordering: creating a parent (supplier/customer) unlocks its
      // children — resolve the extracted contact/location scoped to the new id.
      if (newId && isParent(entity.kind) && extractedRef.current) {
        const child = await resolveChildren(
          carbon,
          documentType,
          extractedRef.current,
          newId
        );
        if (Object.keys(child.values).length)
          setSelected((prev) => ({ ...prev, ...child.values }));
        if (child.unmatched.length) {
          setOptionsByField((prev) => ({
            ...prev,
            ...Object.fromEntries(
              child.unmatched.map((u) => [u.field, u.options])
            )
          }));
          setResolution((prev) =>
            prev
              ? {
                  ...prev,
                  unmatched: [
                    ...prev.unmatched.filter(
                      (u) => !child.unmatched.some((c) => c.field === u.field)
                    ),
                    ...child.unmatched
                  ]
                }
              : prev
          );
        }
      }
    },
    [carbon, documentType]
  );

  const extracting = phase === "uploading" || phase === "extracting";
  const remaining = resolution
    ? resolution.unmatched.filter((e) => !selected[e.field]).length
    : 0;
  const rows = reviewRows(extraction?.extractedData ?? null);
  const previewUrl = uploadedPath
    ? path.to.file.preview("private", uploadedPath)
    : undefined;

  return (
    <>
      <IconButton
        aria-label="Autofill from PDF"
        title="Autofill from PDF"
        variant="secondary"
        icon={<LuSparkles />}
        onClick={drawer.onOpen}
      />

      {drawer.isOpen && (
        <div className="fixed right-0 top-0 z-40 flex h-screen w-full flex-col border-l bg-background shadow-xl lg:w-1/2">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="flex items-center gap-2 font-medium">
              <LuSparkles className="size-5" /> Autofill from PDF
            </span>
            <Button variant="ghost" size="sm" onClick={close}>
              Close
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {phase === "drop" ? (
              <div className="p-6 max-w-xl mx-auto">
                <FileDropzone
                  onDrop={handleDrop}
                  accept={{ "application/pdf": [".pdf"] }}
                  multiple={false}
                />
              </div>
            ) : (
              <div className="flex flex-col h-full min-h-[70vh]">
                {/* Top: source document with click-to-source highlighting */}
                <div className="border-b bg-muted/30 h-[42vh] flex-shrink-0 overflow-hidden">
                  {previewUrl ? (
                    <PdfReviewViewer
                      url={previewUrl}
                      highlightValue={activeHighlight}
                    />
                  ) : null}
                </div>

                {/* Below: review */}
                <div className="p-5 overflow-y-auto flex-1">
                  {extracting && (
                    <HStack spacing={2} className="py-8 justify-center">
                      <LoaderIcon />
                      <span className="text-sm text-muted-foreground">
                        {phase === "uploading"
                          ? "Uploading…"
                          : "Extracting the PDF…"}
                      </span>
                    </HStack>
                  )}

                  {phase === "resolving" && (
                    <HStack spacing={2} className="py-8 justify-center">
                      <LoaderIcon />
                      <span className="text-sm text-muted-foreground">
                        Matching extracted values…
                      </span>
                    </HStack>
                  )}

                  {phase === "failed" && (
                    <VStack spacing={3} className="py-6">
                      <span className="text-sm text-destructive-foreground">
                        ✗ {error}
                      </span>
                      <Button variant="secondary" onClick={reset}>
                        Try again
                      </Button>
                    </VStack>
                  )}

                  {phase === "review" && resolution && (
                    <VStack spacing={4}>
                      {resolution.warnings?.map((w) => (
                        <div
                          key={w}
                          className="flex items-start gap-2 rounded-md border border-orange-300 bg-orange-50 px-4 py-3 w-full text-sm text-orange-900 dark:bg-orange-950/30 dark:text-orange-200"
                        >
                          <LuTriangleAlert className="mt-0.5 size-4 flex-shrink-0" />
                          <span>{w}</span>
                        </div>
                      ))}

                      {/* unresolved-entity banner */}
                      <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-4 py-3 w-full">
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border bg-background">
                          {remaining > 0 ? (
                            <LuListPlus className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <LuCircleCheck className="h-4 w-4 text-emerald-600" />
                          )}
                        </div>
                        <div className="flex min-w-0 flex-col">
                          <span className="text-sm font-medium">
                            {remaining > 0
                              ? `${remaining} ${remaining === 1 ? "value needs" : "values need"} attention`
                              : "All values resolved"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {remaining > 0
                              ? "Map each to an existing record or create a new one."
                              : "Review the fields, then Apply to fill the form."}
                          </span>
                        </div>
                      </div>

                      {resolution.unmatched.length > 0 && (
                        <div className="w-full">
                          <div className="grid grid-cols-2 gap-3 items-center">
                            <div className="font-medium text-sm">From PDF</div>
                            <div className="font-medium text-sm">
                              Carbon record
                            </div>
                            {resolution.unmatched.map((entity) => (
                              <Fragment key={entity.field}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActiveHighlight(entity.label)
                                  }
                                  title="Show on document"
                                  className="flex min-w-0 items-center gap-2 text-left hover:text-primary"
                                >
                                  <span className="truncate">
                                    {entity.label}
                                  </span>
                                  <LuMoveRight className="flex-shrink-0 text-muted-foreground" />
                                </button>
                                <CreatableCombobox
                                  name={entity.field}
                                  value={selected[entity.field]}
                                  isClearable
                                  options={
                                    optionsByField[entity.field] ??
                                    entity.options
                                  }
                                  onChange={(v) =>
                                    setSelected((prev) => {
                                      const next = { ...prev };
                                      if (v?.value)
                                        next[entity.field] = v.value;
                                      else delete next[entity.field];
                                      return next;
                                    })
                                  }
                                  onCreateOption={() => setCreating(entity)}
                                />
                              </Fragment>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* per-field confidence review */}
                      {rows.length > 0 && (
                        <div className="w-full">
                          <div className="text-sm font-medium mb-2">
                            Extracted fields{" "}
                            <span className="text-xs font-normal text-muted-foreground">
                              (click a row to find it on the document)
                            </span>
                          </div>
                          <div className="flex flex-col divide-y rounded-md border">
                            {rows.map((r) => {
                              const b = confidenceBand(r.confidence);
                              const active = activeHighlight === r.value;
                              return (
                                <button
                                  type="button"
                                  key={r.key}
                                  onClick={() => setActiveHighlight(r.value)}
                                  className={`flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/50 ${
                                    active
                                      ? "bg-yellow-100/60 dark:bg-yellow-900/20"
                                      : ""
                                  }`}
                                >
                                  <div className="flex min-w-0 flex-col">
                                    <span className="text-xs text-muted-foreground">
                                      {r.label}
                                    </span>
                                    <span className="truncate text-sm">
                                      {r.value}
                                    </span>
                                  </div>
                                  <Status
                                    color={b.color}
                                    tooltip={`${Math.round(r.confidence * 100)}% confidence`}
                                  >
                                    {b.label}
                                  </Status>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </VStack>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t px-4 py-3">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            {phase === "review" && resolution && (
              <Button onClick={() => applyAndClose(resolution, selected)}>
                Apply
              </Button>
            )}
          </div>
        </div>
      )}

      {creating && (
        <CreateEntityForm
          entity={creating}
          onClose={() => onCreated(creating)}
        />
      )}
    </>
  );
}

function LoaderIcon() {
  return (
    <LuLoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
  );
}
