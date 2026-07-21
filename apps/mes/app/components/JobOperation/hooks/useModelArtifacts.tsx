import { useEffect, useId, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

export type ModelArtifacts = {
  optimizedModelPath: string | null;
  lodPath: string | null;
  glbPath: string | null;
  thumbnailPath: string | null;
  /** Raw upload (non-`.zst`) for the viewer's WASM fallback tier, with its
   *  resolved bucket (temp-staging for current uploads, private for old rows). */
  rawPath: string | null;
  rawBucket: string;
  optimizeStatus:
    | "Idle"
    | "Queued"
    | "Processing"
    | "Success"
    | "Failed"
    | null;
  size: number | null;
  optimizedSize: number | null;
};

// modelUpload.id is the model's filename (`${company}/models/${id}.ext`), so the
// id — and thus its artifact paths — is recoverable from `modelPath` alone.
export function modelIdFromPath(modelPath: string | null): string | null {
  if (!modelPath) return null;
  let base = modelPath.split("/").pop() ?? "";
  // Retained raws are compacted in place (`${id}.step` → `${id}.step.zst`); peel
  // the `.zst` wrapper before the source extension so the id resolves either way.
  if (base.toLowerCase().endsWith(".zst")) base = base.slice(0, -4);
  return base.replace(/\.[^.]+$/, "") || null;
}

/**
 * Resolves a model's assembler artifact paths (optimised / LOD / assembly GLB /
 * thumbnail / raw source) via the `model.artifacts` API loader, keyed by the id
 * derived from `modelPath`. While optimise is in flight it polls so the compact
 * GLB swaps in without a reload; it stops once an interactive artifact lands,
 * optimise fails, or after a bounded window. Parity with the ERP CadModel hook,
 * minus the client cache (MES uses a plain fetcher).
 */
export function useModelArtifacts(modelPath: string | null): {
  artifacts: ModelArtifacts | undefined;
  /** True while a server GLB is genuinely on its way (optimise in flight). */
  pending: boolean;
  /** Restart polling (after a re-optimise is fired) even if it had settled. */
  retry: () => void;
} {
  const uid = useId();
  const modelUploadId = modelIdFromPath(modelPath);
  const fetcher = useFetcher<ModelArtifacts>({
    key: `model-artifacts:${modelUploadId ?? `none:${uid}`}`
  });
  const load = fetcher.load;
  const dataRef = useRef<ModelArtifacts | undefined>(undefined);
  dataRef.current = fetcher.data;
  const [pending, setPending] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // `pending` must mean "a GLB is genuinely on its way", not "still checking":
  // the viewer renders it as an optimise-in-progress spinner. Settle on the
  // first response unless the status is actually in flight; the background
  // polling below re-raises it on a real transition.
  useEffect(() => {
    const data = fetcher.data;
    if (!data) return;
    const inFlight =
      data.optimizeStatus === "Queued" || data.optimizeStatus === "Processing";
    setPending(inFlight && !(data.optimizedModelPath || data.glbPath));
  }, [fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey re-runs the effect on retry without being read inside it
  useEffect(() => {
    if (!modelUploadId) {
      setPending(false);
      return;
    }
    setPending(true);
    const url = path.to.api.modelArtifacts(modelUploadId);
    load(url);

    let attempts = 0;
    const timer = setInterval(() => {
      const data = dataRef.current;
      const hasInteractive = Boolean(data?.optimizedModelPath || data?.glbPath);
      if (hasInteractive || data?.optimizeStatus === "Failed") {
        clearInterval(timer);
        setPending(false);
        return;
      }
      const inFlight =
        data?.optimizeStatus === "Queued" ||
        data?.optimizeStatus === "Processing";
      // `Idle`/undefined is the brief window before the job starts (or a
      // non-mesh upload that never optimises) — keep polling quietly for a
      // grace period (pending is driven by the data effect above).
      const cap = inFlight ? 60 : 8; // ~3min in flight vs ~24s settling
      attempts += 1;
      if (attempts > cap) {
        clearInterval(timer);
        setPending(false);
        return;
      }
      load(url);
    }, 3000);

    return () => clearInterval(timer);
  }, [modelUploadId, load, reloadKey]);

  return {
    artifacts: fetcher.data,
    pending,
    retry: () => setReloadKey((k) => k + 1)
  };
}
