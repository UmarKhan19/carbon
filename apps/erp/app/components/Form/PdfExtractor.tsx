import { Button, HStack, useCarbon, VStack } from "@carbon/react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useUser } from "~/hooks";
import { useDocumentExtraction } from "~/hooks/useDocumentExtraction";

type PdfExtractorProps = {
  documentType: "purchaseInvoice" | "salesRfq";
  sourceDocument: string;
  sourceDocumentId?: string;
  onExtractionComplete: (data: Record<string, any>) => void;
};

export function PdfExtractor({
  documentType,
  sourceDocument,
  sourceDocumentId,
  onExtractionComplete
}: PdfExtractorProps) {
  const { carbon: supabase } = useCarbon();
  const { company } = useUser();
  const fetcher = useFetcher<{ extractionId?: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [extractionId, setExtractionId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [notifiedExtractionId, setNotifiedExtractionId] = useState<
    string | null
  >(null);

  const { extraction } = useDocumentExtraction(extractionId);

  // When extraction completes, notify parent
  useEffect(() => {
    if (
      extraction?.status === "completed" &&
      extraction.filteredData &&
      extractionId !== notifiedExtractionId
    ) {
      setNotifiedExtractionId(extractionId);
      onExtractionComplete({
        ...extraction.filteredData,
        _storagePath: extraction.storagePath
      });
    }
  }, [
    extraction?.status,
    extraction?.filteredData,
    extraction?.storagePath,
    onExtractionComplete,
    extractionId,
    notifiedExtractionId
  ]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.name.endsWith(".pdf")) return;

    setUploading(true);
    const storagePath = `${company.id}/extractions/${Date.now()}_${file.name}`;

    if (!supabase) return;

    const { error } = await supabase.storage
      .from("private")
      .upload(storagePath, file);

    if (error) {
      console.error("Upload failed", error);
      setUploading(false);
      return;
    }

    // Trigger extraction via API
    const formData = new FormData();
    formData.append("storagePath", storagePath);
    formData.append("documentType", documentType);
    formData.append("sourceDocument", sourceDocument);
    if (sourceDocumentId) formData.append("sourceDocumentId", sourceDocumentId);

    fetcher.submit(formData, {
      method: "post",
      action: "/api/document-extraction"
    });

    setUploading(false);
  };

  // Extract the extractionId from fetcher response
  if (fetcher.data?.extractionId && !extractionId) {
    setExtractionId(fetcher.data.extractionId);
  }

  const status = extraction?.status;

  return (
    <VStack spacing={2} className="mb-4 p-4 border rounded-md bg-muted/50">
      <HStack>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={handleUpload}
          className="hidden"
        />
        <Button
          variant="secondary"
          size="md"
          onClick={() => fileInputRef.current?.click()}
          isDisabled={uploading || status === "processing"}
        >
          {uploading ? "Uploading..." : "Auto-fill from PDF"}
        </Button>
      </HStack>
      {status === "processing" && (
        <p className="text-sm text-muted-foreground animate-pulse">
          Extracting data from PDF...
        </p>
      )}
      {status === "completed" && (
        <p className="text-sm text-green-600">
          ✓ Fields populated from PDF. Please review before saving.
        </p>
      )}
      {status === "failed" && (
        <p className="text-sm text-red-600">
          ✗ Extraction failed: {extraction?.error}
        </p>
      )}
    </VStack>
  );
}
