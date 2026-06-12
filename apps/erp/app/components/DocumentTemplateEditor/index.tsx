import type {
  DocumentBlock,
  DocumentSettings,
  DocumentTemplateType,
  DocumentTheme
} from "@carbon/documents/template";
import { getDocumentLabel } from "@carbon/documents/template";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  Combobox,
  Heading,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from "@carbon/react";
import { type ReactNode, useState } from "react";
import { LuArrowLeft, LuPalette } from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";
import { BlockConfig } from "./BlockConfig";
import { BlockList } from "./BlockList";
import type { CustomFieldRef, PreviewEntity, SectionRef } from "./context";
import { DocumentTemplateProvider, useDocumentTemplate } from "./context";
import { FontConfig } from "./FontConfig";
import { TemplatePreview } from "./TemplatePreview";
import { ThemeConfig } from "./ThemeConfig";

export function DocumentTemplateEditor({
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
  canEdit
}: {
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
  canEdit: boolean;
}) {
  return (
    <DocumentTemplateProvider
      documentType={documentType}
      actionPath={actionPath}
      initialBlocks={initialBlocks}
      initialTheme={initialTheme}
      initialSettings={initialSettings}
      initialHeaderSectionId={initialHeaderSectionId}
      initialFooterSectionId={initialFooterSectionId}
      sections={sections}
      customFields={customFields}
      previewEntities={previewEntities}
      termsSeed={termsSeed}
      hasWatermark={hasWatermark}
    >
      <div className="flex h-full w-full min-w-0 flex-col bg-background">
        <EditorToolbar
          title={getDocumentLabel(documentType)}
          canEdit={canEdit}
        />
        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="document-template-editor"
          className="flex-1 overflow-hidden"
        >
          {/* LEFT — blocks + theme */}
          <ResizablePanel
            id="rail"
            order={1}
            defaultSize={22}
            minSize={16}
            maxSize={34}
          >
            <ControlRail />
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* CENTER — canvas */}
          <ResizablePanel id="canvas" order={2} defaultSize={56} minSize={30}>
            <div className="flex h-full min-w-0 flex-col bg-muted/40 p-6">
              <TemplatePreview previewPath={`${actionPath}/preview`} />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* RIGHT — contextual config, always present */}
          <ResizablePanel
            id="config"
            order={3}
            defaultSize={22}
            minSize={16}
            maxSize={34}
          >
            <ScrollArea className="h-full bg-card">
              <div className="flex flex-col gap-1.5 p-3">
                <h2 className={RAIL_HEADING}>Configure</h2>
                <BlockConfig />
              </div>
            </ScrollArea>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </DocumentTemplateProvider>
  );
}

const RAIL_HEADING =
  "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

/**
 * Left rail: block layers (incl. the Header block + Footer row) and a Page /
 * Theme tab group for document-wide settings. The contextual Configure panel
 * lives in its own right rail.
 */
function ControlRail() {
  const [tab, setTab] = useState<"style">("style");

  return (
    <ScrollArea className="h-full bg-card">
      <div className="flex flex-col gap-4 p-3">
        <section className="flex flex-col gap-1.5">
          <h2 className={RAIL_HEADING}>Blocks</h2>
          <BlockList />
        </section>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "style")}
          className="border-t pt-1"
        >
          <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b bg-transparent p-0 shadow-none">
            <UnderlineTab value="style" icon={<LuPalette />} label="Style" />
          </TabsList>
          <TabsContent value="style" className="flex flex-col gap-5 pt-4">
            <section className="flex flex-col gap-3">
              <h3 className={RAIL_HEADING}>Typography</h3>
              <FontConfig />
            </section>
            <section className="flex flex-col gap-2">
              <h3 className={RAIL_HEADING}>Theme colors</h3>
              <ThemeConfig />
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
}

/** Clean underline-style tab trigger with a generous hit area. */
function UnderlineTab({
  value,
  icon,
  label
}: {
  value: string;
  icon: ReactNode;
  label: string;
}) {
  return (
    <TabsTrigger
      value={value}
      className="-mb-px gap-1.5 rounded-none border-0 border-b-2 border-transparent bg-transparent px-3 py-2 text-xs text-muted-foreground shadow-none data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
    >
      <span className="[&>svg]:size-3.5">{icon}</span>
      {label}
    </TabsTrigger>
  );
}

function EditorToolbar({
  title,
  canEdit
}: {
  title: string;
  canEdit: boolean;
}) {
  const {
    isDirty,
    isSaving,
    reset,
    save,
    previewEntities,
    previewId,
    setPreviewId
  } = useDocumentTemplate();

  return (
    <div className="flex items-center justify-between gap-3 border-b bg-card px-4 py-3">
      <div className="flex items-center gap-3">
        <Link
          to={path.to.documentTemplates}
          aria-label="Back to documents"
          className="flex size-8 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LuArrowLeft className="size-4" />
        </Link>
        <div className="flex flex-col">
          <Heading size="h4">Document Layout</Heading>
          <p className="text-xs text-muted-foreground">{title}</p>
        </div>
      </div>
      {previewEntities.length > 0 && (
        <div className="flex min-w-0 max-w-[280px] flex-1 justify-center">
          <Combobox
            size="sm"
            className="w-full"
            value={previewId ?? ""}
            options={previewEntities.map((e) => ({
              label: e.label,
              value: e.id
            }))}
            onChange={(value) => setPreviewId(value || null)}
            placeholder="Sample data"
          />
        </div>
      )}
      {canEdit && (
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={reset}
            isDisabled={!isDirty || isSaving}
          >
            Discard
          </Button>
          <Button onClick={save} isLoading={isSaving} isDisabled={!isDirty}>
            Save layout
          </Button>
        </div>
      )}
    </div>
  );
}
