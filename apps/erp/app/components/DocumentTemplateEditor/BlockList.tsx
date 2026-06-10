import {
  BLOCK_META,
  BUILT_IN_SECTION_IDS,
  supportsCustomBlocks
} from "@carbon/documents/template";
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@carbon/react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";
import {
  LuEye,
  LuEyeOff,
  LuGripVertical,
  LuLibrary,
  LuLock,
  LuPanelBottom,
  LuPanelTop,
  LuPlus,
  LuSeparatorHorizontal,
  LuTable,
  LuTag,
  LuTrash2,
  LuType
} from "react-icons/lu";
import { Link } from "react-router";
import { path } from "~/utils/path";
import {
  type AddableBlockType,
  FOOTER_BLOCK_ID,
  useDocumentTemplate
} from "./context";

const ADD_OPTIONS: {
  type: AddableBlockType;
  icon: ReactNode;
  description: string;
}[] = [
  {
    type: "richText",
    icon: <LuType className="size-4" />,
    description: "Formatted text with merge fields"
  },
  {
    type: "keyValue",
    icon: <LuTable className="size-4" />,
    description: "Label / value rows"
  },
  {
    type: "spacer",
    icon: <LuSeparatorHorizontal className="size-4" />,
    description: "Space, divider, or page break"
  }
];

export function BlockList() {
  const {
    documentType,
    blocks,
    reorder,
    addBlock,
    addSharedBlock,
    addCustomFieldBlock,
    sections,
    customFields
  } = useDocumentTemplate();
  const canAddBlocks = supportsCustomBlocks(documentType);
  const bodySections = sections.filter((s) => s.placement === "body");
  // Header & footer are page chrome — pinned (not reorderable). Only the body
  // blocks between them are sortable.
  const headerBlock = blocks.find((b) => b.type === "header");
  const bodyBlocks = blocks.filter((b) => b.type !== "header");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorder(String(active.id), String(over.id));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        {headerBlock && <HeaderRow id={headerBlock.id} />}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={bodyBlocks.map((b) => b.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-1">
            {bodyBlocks.map((block) => (
              <BlockRow key={block.id} id={block.id} />
            ))}
            <FooterRow />
          </div>
        </SortableContext>
      </DndContext>

      {canAddBlocks && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              leftIcon={<LuPlus />}
              className="w-full border-dashed"
            >
              Add block
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-[--radix-popper-anchor-width] min-w-64"
          >
            {ADD_OPTIONS.map(({ type, icon, description }) => (
              <DropdownMenuItem
                key={type}
                onClick={() => addBlock(type)}
                className="flex items-start gap-2.5 py-2"
              >
                <span className="mt-0.5 text-muted-foreground">{icon}</span>
                <span className="flex flex-col">
                  <span className="text-sm font-medium">
                    {BLOCK_META[type].label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {description}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Shared sections</DropdownMenuLabel>
            {bodySections.map((section) => (
              <DropdownMenuItem
                key={section.id}
                onClick={() => addSharedBlock(section.id)}
                className="flex items-center gap-2.5"
              >
                <LuLibrary className="size-4 text-muted-foreground" />
                <span className="text-sm">{section.name}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem asChild className="flex items-center gap-2.5">
              <Link to={path.to.documentSections}>
                <LuPlus className="size-4 text-muted-foreground" />
                <span className="text-sm">
                  {bodySections.length > 0
                    ? "New shared section"
                    : "Create a shared section"}
                </span>
              </Link>
            </DropdownMenuItem>

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Custom fields</DropdownMenuLabel>
            {customFields.map((field) => (
              <DropdownMenuItem
                key={field.id}
                onClick={() => addCustomFieldBlock(field.id, field.name)}
                className="flex items-center gap-2.5"
              >
                <LuTag className="size-4 text-muted-foreground" />
                <span className="text-sm">{field.name}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem asChild className="flex items-center gap-2.5">
              <Link to={path.to.customFields}>
                <LuPlus className="size-4 text-muted-foreground" />
                <span className="text-sm">
                  {customFields.length > 0
                    ? "Manage custom fields"
                    : "Create a custom field"}
                </span>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function BlockRow({ id }: { id: string }) {
  const { blocks, sections, selectedId, select, toggleVisible, removeBlock } =
    useDocumentTemplate();
  const block = blocks.find((b) => b.id === id);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  if (!block) return null;
  const meta = BLOCK_META[block.type];
  const isSelected = selectedId === id;
  const shown = block.visible;
  const onToggle = () => toggleVisible(id);
  const label =
    block.type === "shared"
      ? (sections.find((s) => s.id === block.sectionId)?.name ??
        "Shared Section (deleted)")
      : block.type === "customField"
        ? block.label || meta.label
        : meta.label;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: transition ?? undefined
      }}
      onClick={() => select(isSelected ? null : id)}
      className={cn(
        "group flex cursor-pointer items-center gap-1.5 rounded-md border px-1.5 py-2",
        "transition-colors duration-150",
        isSelected
          ? "border-primary bg-accent/50"
          : "border-transparent hover:border-border hover:bg-accent/30",
        isDragging && "opacity-50 shadow-sm",
        !shown && !isSelected && "opacity-60"
      )}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        onClick={(e) => e.stopPropagation()}
        className="cursor-grab text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <LuGripVertical className="size-4" />
      </button>

      <span className="flex flex-1 items-center gap-2 truncate text-sm">
        <span className="truncate">{label}</span>
        {block.type === "shared" ? (
          <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Shared
          </span>
        ) : (
          !meta.isBuiltIn && (
            <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Custom
            </span>
          )
        )}
      </span>

      {meta.removable && (
        <button
          type="button"
          aria-label="Remove block"
          onClick={(e) => {
            e.stopPropagation();
            removeBlock(id);
          }}
          className="rounded p-1 text-muted-foreground opacity-0 transition-[opacity,color] hover:text-destructive group-hover:opacity-100"
        >
          <LuTrash2 className="size-4" />
        </button>
      )}

      {meta.hideable ? (
        <button
          type="button"
          aria-label={shown ? "Hide block" : "Show block"}
          aria-pressed={shown}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={cn(
            "rounded p-1 transition-colors",
            shown
              ? "text-foreground hover:bg-muted"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          {shown ? (
            <LuEye className="size-4" />
          ) : (
            <LuEyeOff className="size-4" />
          )}
        </button>
      ) : (
        <span
          title="Required — always shown"
          className="p-1 text-muted-foreground/50"
        >
          <LuLock className="size-3.5" />
        </span>
      )}
    </div>
  );
}

/**
 * The page Header — pinned (not reorderable). Eye toggles it on/off; selecting
 * it opens the header config (a link to its global shared section).
 */
function HeaderRow({ id }: { id: string }) {
  const { selectedId, select, headerSectionId, setHeaderSection } =
    useDocumentTemplate();
  const isSelected = selectedId === id;
  const shown = headerSectionId !== null;

  return (
    <ChromeRow
      icon={<LuPanelTop className="size-4" />}
      label="Header"
      isSelected={isSelected}
      shown={shown}
      onSelect={() => select(isSelected ? null : id)}
      onToggle={() =>
        setHeaderSection(shown ? null : BUILT_IN_SECTION_IDS.header)
      }
    />
  );
}

/**
 * The page Footer — chrome, not a flow block, so it's a static row pinned below
 * the sortable blocks. Eye toggles the footer on/off; selecting it opens the
 * footer config (page numbers, registration line).
 */
function FooterRow() {
  const { footerSectionId, setFooterSection, selectedId, select } =
    useDocumentTemplate();
  const isSelected = selectedId === FOOTER_BLOCK_ID;
  const shown = footerSectionId !== null;

  return (
    <ChromeRow
      icon={<LuPanelBottom className="size-4" />}
      label="Footer"
      isSelected={isSelected}
      shown={shown}
      onSelect={() => select(isSelected ? null : FOOTER_BLOCK_ID)}
      onToggle={() =>
        setFooterSection(shown ? null : BUILT_IN_SECTION_IDS.footer)
      }
    />
  );
}

/** Shared presentation for the pinned, non-draggable Header & Footer rows. */
function ChromeRow({
  icon,
  label,
  isSelected,
  shown,
  onSelect,
  onToggle
}: {
  icon: ReactNode;
  label: string;
  isSelected: boolean;
  shown: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "group flex cursor-pointer items-center gap-1.5 rounded-md border px-1.5 py-2",
        "transition-colors duration-150",
        isSelected
          ? "border-primary bg-accent/50"
          : "border-transparent hover:border-border hover:bg-accent/30",
        !shown && !isSelected && "opacity-60"
      )}
    >
      <span className="p-1 text-muted-foreground/40">{icon}</span>
      <span className="flex flex-1 items-center gap-2 truncate text-sm">
        <span className="truncate">{label}</span>
        <span className="rounded bg-muted px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Page
        </span>
      </span>
      <button
        type="button"
        aria-label={shown ? `Hide ${label}` : `Show ${label}`}
        aria-pressed={shown}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={cn(
          "rounded p-1 transition-colors",
          shown
            ? "text-foreground hover:bg-muted"
            : "text-muted-foreground hover:bg-muted"
        )}
      >
        {shown ? <LuEye className="size-4" /> : <LuEyeOff className="size-4" />}
      </button>
    </div>
  );
}
