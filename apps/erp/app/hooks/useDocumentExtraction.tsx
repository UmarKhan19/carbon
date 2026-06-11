import { useCarbon, useRealtimeChannel } from "@carbon/react";
import { useCallback, useState } from "react";
import { useUser } from "./useUser";

type ExtractionStatus = "pending" | "processing" | "completed" | "failed";

type DocumentExtractionState = {
  id: string;
  status: ExtractionStatus;
  filteredData: Record<string, unknown> | null;
  error: string | null;
};

/**
 * Subscribes to realtime updates on a documentExtraction row.
 * Returns the latest extraction state, including the filtered
 * (confidence-gated) data once completed.
 */
export function useDocumentExtraction(extractionId: string | null) {
  const { company } = useUser();
  const { carbon: supabase } = useCarbon();
  const [extraction, setExtraction] = useState<DocumentExtractionState | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);

  // Initial fetch when extractionId is set
  const fetchInitial = useCallback(async () => {
    if (!extractionId || !supabase) return;
    setIsLoading(true);
    const { data } = await supabase
      .from("documentExtraction")
      .select("id, status, filteredData, error")
      .eq("id", extractionId)
      .single();

    if (data) {
      setExtraction(data as unknown as DocumentExtractionState);
    }
    setIsLoading(false);
  }, [extractionId, supabase]);

  // Subscribe to realtime changes
  useRealtimeChannel({
    topic: `extraction:${extractionId ?? "none"}`,
    dependencies: [extractionId, company.id],
    setup(channel) {
      // Fetch initial data on subscribe
      fetchInitial();

      return channel.on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "documentExtraction",
          filter: extractionId ? `id=eq.${extractionId}` : undefined
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.companyId !== company.id) return;

          setExtraction({
            id: row.id as string,
            status: row.status as ExtractionStatus,
            filteredData: row.filteredData as Record<string, unknown> | null,
            error: row.error as string | null
          });
        }
      );
    }
  });

  return { extraction, isLoading };
}
