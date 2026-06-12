import type {
  DocumentBlock,
  DocumentBlockType,
  DocumentSettings,
  DocumentTemplateType,
  DocumentTheme,
  HeaderOptions
} from "@carbon/documents/template";
import type { JSONContent } from "@carbon/react";
import { arrayMove } from "@dnd-kit/sortable";
import { nanoid } from "nanoid";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useFetcher } from "react-router";

type AddableBlockType = Extract<
  DocumentBlockType,
  "richText" | "keyValue" | "spacer"
>;

export interface SectionRef {
  id: string;
  name: string;
  placement: "body" | "header" | "footer";
  /** Present for header/footer so the editor can open the edit dialog inline. */
  content?: JSONContent;
  config?: Partial<HeaderOptions>;
}

/**
 * Synthetic selection id for the page Footer. The footer is page chrome, not a
 * flow block, so it isn't in `blocks` — but it gets a row in the list and a
 * config panel keyed off this id.
 */
export const FOOTER_BLOCK_ID = "__footer__";

/** A custom field available to insert (id + display name). */
export interface CustomFieldRef {
  id: string;
  name: string;
}

/** A real record the preview can render against (id + readable label). */
export interface PreviewEntity {
  id: string;
  label: string;
}

/**
 * Generic editor interface: state + actions + meta. The provider is the only
 * place that knows blocks live in React state and persist via a fetcher;
 * consumers depend on this shape, not the implementation.
 */
interface DocumentTemplateContextValue {
  // state
  documentType: DocumentTemplateType;
  blocks: DocumentBlock[];
  theme: DocumentTheme;
  settings: DocumentSettings;
  headerSectionId: string | null;
  footerSectionId: string | null;
  /** All shared sections available to reference (id, name, placement). */
  sections: SectionRef[];
  /** Custom fields available to insert as blocks. */
  customFields: CustomFieldRef[];
  /** Company terms setting — seeds the Terms block when it has no content. */
  termsSeed?: JSONContent;
  /** Real records the preview can render against. */
  previewEntities: PreviewEntity[];
  /** Whether the company has a watermark logo set (gates the watermark toggle). */
  hasWatermark: boolean;
  /** Selected record id for live-data preview (null = sample data). */
  previewId: string | null;
  setPreviewId: (id: string | null) => void;
  selectedId: string | null;
  // actions
  select: (id: string | null) => void;
  addBlock: (type: AddableBlockType) => void;
  addSharedBlock: (sectionId: string) => void;
  addCustomFieldBlock: (fieldId: string, label: string) => void;
  /** Add a single-line field. `withLabel` seeds an empty label (key-value). */
  addField: (withLabel: boolean) => void;
  removeBlock: (id: string) => void;
  toggleVisible: (id: string) => void;
  reorder: (activeId: string, overId: string) => void;
  updateBlock: (id: string, patch: Partial<DocumentBlock>) => void;
  setThemeColor: (key: keyof DocumentTheme, value: string) => void;
  setSetting: <K extends keyof DocumentSettings>(
    key: K,
    value: DocumentSettings[K]
  ) => void;
  setHeaderSection: (sectionId: string | null) => void;
  setFooterSection: (sectionId: string | null) => void;
  reset: () => void;
  save: () => void;
  // meta
  isDirty: boolean;
  isSaving: boolean;
}

const DocumentTemplateContext =
  createContext<DocumentTemplateContextValue | null>(null);

export function useDocumentTemplate() {
  const ctx = useContext(DocumentTemplateContext);
  if (!ctx) {
    throw new Error(
      "useDocumentTemplate must be used within a DocumentTemplateProvider"
    );
  }
  return ctx;
}

function createBlock(type: AddableBlockType): DocumentBlock {
  const id = nanoid();
  switch (type) {
    case "richText":
      return { id, type, visible: true, content: { type: "doc", content: [] } };
    case "keyValue":
      return { id, type, visible: true, rows: [] };
    case "spacer":
      return { id, type, visible: true, variant: "space" };
  }
}

export function DocumentTemplateProvider({
  documentType,
  actionPath,
  initialBlocks,
  initialTheme,
  initialSettings,
  initialHeaderSectionId,
  initialFooterSectionId,
  sections,
  customFields,
  previewEntities,
  termsSeed,
  hasWatermark,
  children
}: PropsWithChildren<{
  documentType: DocumentTemplateType;
  actionPath: string;
  initialBlocks: DocumentBlock[];
  initialTheme: DocumentTheme;
  initialSettings: DocumentSettings;
  initialHeaderSectionId: string | null;
  initialFooterSectionId: string | null;
  sections: SectionRef[];
  customFields: CustomFieldRef[];
  previewEntities: PreviewEntity[];
  termsSeed?: JSONContent;
  hasWatermark: boolean;
}>) {
  const fetcher = useFetcher<{ success?: boolean }>();
  const [blocks, setBlocks] = useState<DocumentBlock[]>(initialBlocks);
  const [theme, setTheme] = useState<DocumentTheme>(initialTheme);
  const [settings, setSettings] = useState<DocumentSettings>(initialSettings);
  const [headerSectionId, setHeaderSectionId] = useState<string | null>(
    initialHeaderSectionId
  );
  const [footerSectionId, setFooterSectionId] = useState<string | null>(
    initialFooterSectionId
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const submittedRef = useRef(false);

  const isSaving = fetcher.state !== "idle";

  const isDirty = useMemo(
    () =>
      JSON.stringify(blocks) !== JSON.stringify(initialBlocks) ||
      JSON.stringify(theme) !== JSON.stringify(initialTheme) ||
      JSON.stringify(settings) !== JSON.stringify(initialSettings) ||
      headerSectionId !== initialHeaderSectionId ||
      footerSectionId !== initialFooterSectionId,
    [
      blocks,
      theme,
      settings,
      headerSectionId,
      footerSectionId,
      initialBlocks,
      initialTheme,
      initialSettings,
      initialHeaderSectionId,
      initialFooterSectionId
    ]
  );

  const addBlock = useCallback((type: AddableBlockType) => {
    const block = createBlock(type);
    setBlocks((prev) => [...prev, block]);
    setSelectedId(block.id);
  }, []);

  const addSharedBlock = useCallback((sectionId: string) => {
    const block: DocumentBlock = {
      id: nanoid(),
      type: "shared",
      visible: true,
      sectionId
    };
    setBlocks((prev) => [...prev, block]);
    setSelectedId(block.id);
  }, []);

  const addCustomFieldBlock = useCallback((fieldId: string, label: string) => {
    const block: DocumentBlock = {
      id: nanoid(),
      type: "customField",
      visible: true,
      fieldId,
      label
    };
    setBlocks((prev) => [...prev, block]);
    setSelectedId(block.id);
  }, []);

  const addField = useCallback((withLabel: boolean) => {
    const block: DocumentBlock = {
      id: nanoid(),
      type: "field",
      visible: true,
      value: "",
      ...(withLabel ? { label: "" } : {})
    };
    setBlocks((prev) => [...prev, block]);
    setSelectedId(block.id);
  }, []);

  const removeBlock = useCallback((id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  const toggleVisible = useCallback((id: string) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, visible: !b.visible } : b))
    );
  }, []);

  const reorder = useCallback((activeId: string, overId: string) => {
    setBlocks((prev) => {
      const from = prev.findIndex((b) => b.id === activeId);
      const to = prev.findIndex((b) => b.id === overId);
      if (from === -1 || to === -1) return prev;
      return arrayMove(prev, from, to);
    });
  }, []);

  const updateBlock = useCallback(
    (id: string, patch: Partial<DocumentBlock>) => {
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === id ? ({ ...b, ...patch } as DocumentBlock) : b
        )
      );
    },
    []
  );

  const setThemeColor = useCallback(
    (key: keyof DocumentTheme, value: string) => {
      setTheme((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const setSetting = useCallback(
    <K extends keyof DocumentSettings>(key: K, value: DocumentSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const reset = useCallback(() => {
    setBlocks(initialBlocks);
    setTheme(initialTheme);
    setSettings(initialSettings);
    setHeaderSectionId(initialHeaderSectionId);
    setFooterSectionId(initialFooterSectionId);
    setSelectedId(null);
  }, [
    initialBlocks,
    initialTheme,
    initialSettings,
    initialHeaderSectionId,
    initialFooterSectionId
  ]);

  const save = useCallback(() => {
    const formData = new FormData();
    formData.append("documentType", documentType);
    formData.append("blocks", JSON.stringify(blocks));
    formData.append("theme", JSON.stringify(theme));
    formData.append("settings", JSON.stringify(settings));
    formData.append("headerSectionId", headerSectionId ?? "");
    formData.append("footerSectionId", footerSectionId ?? "");
    submittedRef.current = true;
    fetcher.submit(formData, { method: "post", action: actionPath });
  }, [
    actionPath,
    blocks,
    theme,
    settings,
    headerSectionId,
    footerSectionId,
    documentType,
    fetcher
  ]);

  // Clear the dirty baseline once our save resolves: react-router revalidates
  // the loader, so `initialBlocks` updates and isDirty falls back to false.
  useEffect(() => {
    if (
      submittedRef.current &&
      fetcher.state === "idle" &&
      fetcher.data?.success
    ) {
      submittedRef.current = false;
    }
  }, [fetcher.data, fetcher.state]);

  const value = useMemo<DocumentTemplateContextValue>(
    () => ({
      documentType,
      blocks,
      theme,
      settings,
      headerSectionId,
      footerSectionId,
      sections,
      customFields,
      termsSeed,
      previewEntities,
      hasWatermark,
      previewId,
      setPreviewId,
      selectedId,
      select: setSelectedId,
      addBlock,
      addSharedBlock,
      addCustomFieldBlock,
      addField,
      removeBlock,
      toggleVisible,
      reorder,
      updateBlock,
      setThemeColor,
      setSetting,
      setHeaderSection: setHeaderSectionId,
      setFooterSection: setFooterSectionId,
      reset,
      save,
      isDirty,
      isSaving
    }),
    [
      documentType,
      blocks,
      theme,
      settings,
      headerSectionId,
      footerSectionId,
      sections,
      customFields,
      termsSeed,
      previewEntities,
      hasWatermark,
      previewId,
      selectedId,
      addBlock,
      addSharedBlock,
      addCustomFieldBlock,
      addField,
      removeBlock,
      toggleVisible,
      reorder,
      updateBlock,
      setThemeColor,
      setSetting,
      reset,
      save,
      isDirty,
      isSaving
    ]
  );

  return (
    <DocumentTemplateContext.Provider value={value}>
      {children}
    </DocumentTemplateContext.Provider>
  );
}

export type { AddableBlockType };
