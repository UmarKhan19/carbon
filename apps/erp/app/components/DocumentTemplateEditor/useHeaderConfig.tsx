import {
  BUILT_IN_SECTION_IDS,
  DEFAULT_HEADER_OPTIONS,
  type HeaderOptions
} from "@carbon/documents/template";
import { useCallback, useMemo } from "react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import { useDocumentTemplate } from "./context";

/** Synthetic selection id for the header's Logo child node in the block tree. */
export const HEADER_LOGO_ID = "__header_logo__";

/**
 * Read + persist the document header's layout config (logo + which fields
 * show). The header is a global shared section, so its config is saved through
 * the `documentSections` action (same as the edit dialog) — the loader then
 * revalidates and the preview re-renders. `patch` merges into the current
 * config so independent fields (logo vs. address toggles) don't clobber.
 */
export function useHeaderConfig() {
  const { sections } = useDocumentTemplate();
  const fetcher = useFetcher();
  const section = sections.find((s) => s.id === BUILT_IN_SECTION_IDS.header);
  const config = useMemo<HeaderOptions>(
    () => ({ ...DEFAULT_HEADER_OPTIONS, ...(section?.config ?? {}) }),
    [section?.config]
  );

  const submit = useCallback(
    (next: HeaderOptions) => {
      if (!section) return;
      const data = new FormData();
      if (section.id) data.set("id", section.id);
      data.set("name", section.name);
      data.set("placement", section.placement);
      data.set(
        "content",
        JSON.stringify(section.content ?? { type: "doc", content: [] })
      );
      data.set("config", JSON.stringify(next));
      fetcher.submit(data, {
        method: "post",
        action: path.to.documentSections
      });
    },
    [section, fetcher]
  );

  /** Merge a partial change into the current config and persist (one-shot). */
  const patch = useCallback(
    (partial: Partial<HeaderOptions>) => submit({ ...config, ...partial }),
    [submit, config]
  );

  return { section, config, submit, patch };
}
