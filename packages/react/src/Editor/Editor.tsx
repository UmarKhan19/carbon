"use client";

import type { JSONContent, MentionSuggestion } from "@carbon/tiptap";
import {
  Command,
  createImageUpload,
  createMentionExtension,
  EditorBubble,
  EditorCommand,
  EditorCommandEmpty,
  EditorCommandItem,
  EditorCommandList,
  EditorContent,
  EditorRoot,
  handleCommandNavigation,
  handleImageDrop,
  handleImagePaste,
  ImageResizer,
  renderItems
} from "@carbon/tiptap";
import TextStyle from "@tiptap/extension-text-style";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Separator } from "../Separator";
import { cn } from "../utils/cn";
import { ColorSelector } from "./components/ColorSelector";
import { LinkSelector } from "./components/LinkSelector";
import { NodeSelector } from "./components/NodeSelector";
import { TextButtons } from "./components/TextButton";
import { defaultExtensions } from "./extensions";
import { getSuggestionItems } from "./slash";

interface MentionConfig {
  /**
   * Trigger character for this mention type (e.g., "@" for items)
   */
  char: string;
  /**
   * List of suggestions to show
   */
  items: MentionSuggestion[];
}

interface EditorProp {
  className?: string;
  initialValue?: JSONContent;
  onChange: (value: JSONContent) => void;
  onUpload?: (file: File) => Promise<string>;
  disableFileUpload?: boolean;
  /**
   * Optional mention configurations. Each config creates a mention extension
   * with a unique trigger character.
   * @example
   * mentions={[
   *   { char: "@", items: [{ id: "1", label: "Widget A" }] }
   * ]}
   */
  mentions?: MentionConfig[];
}

const defaultOnUpload = async (file: File) => {
  alert(
    "onUpload is not implemented. Please pass an onUpload function to the Editor. Trying to upload " +
      file.name
  );
};

const Editor = ({
  className,
  initialValue,
  onChange,
  onUpload,
  disableFileUpload,
  mentions
}: EditorProp) => {
  const [openNode, setOpenNode] = useState(false);
  const [openColor, setOpenColor] = useState(false);
  const [openLink, setOpenLink] = useState(false);

  // Use a ref to hold the current mention items so the extension can access
  // the latest items without needing to be recreated
  const mentionItemsRef = useRef<MentionSuggestion[]>([]);
  if (mentions && mentions.length > 0) {
    mentionItemsRef.current = mentions[0]!.items;
  }

  const uploadFn = useMemo(() => {
    const uploadHandler = onUpload ? onUpload : defaultOnUpload;
    return createImageUpload({
      onUpload: uploadHandler,
      validateFn: (file) => {
        if (disableFileUpload) {
          toast.error("File upload is not supported for external scars");
          return false;
        }
        if (!file.type.includes("image/")) {
          toast.error(`File type ${file.type} not supported.`);
          return false;
        } else if (file.size / 1024 / 1024 > 20) {
          toast.error("File size too big (max 20MB).");
          return false;
        }
        return true;
      }
    });
  }, [onUpload, disableFileUpload]);

  const suggestionItems = useMemo(
    () => getSuggestionItems(uploadFn),
    [uploadFn]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const mentionExtension = useMemo(() => {
    if (!mentions || mentions.length === 0) return null;
    // Use the first mention config - if multiple are needed with different
    // trigger characters, this would need to be extended
    const config = mentions[0]!;
    return createMentionExtension({
      name: "mention",
      char: config.char,
      // Pass a getter function so the extension always gets the latest items
      items: () => mentionItemsRef.current
    });
    // Only depend on mentions existence and char, not items content
  }, [mentions?.[0]?.char]);

  const extensions = useMemo(
    () => [
      ...defaultExtensions,
      TextStyle,
      Command.configure({
        suggestion: {
          items: () => suggestionItems,
          render: renderItems
        } as any
      }),
      ...(mentionExtension ? [mentionExtension] : [])
    ],
    [suggestionItems, mentionExtension]
  );

  return (
    <EditorRoot>
      <EditorContent
        className={cn("[&_.is-empty]:text-muted-foreground", className)}
        {...(initialValue && { initialContent: initialValue })}
        extensions={extensions}
        editorProps={{
          handleDOMEvents: {
            keydown: (_view, event) => handleCommandNavigation(event)
          },
          handlePaste: (view, event) => handleImagePaste(view, event, uploadFn),
          handleDrop: (view, event, _slice, moved) =>
            handleImageDrop(view, event, moved, uploadFn),
          attributes: {
            class: `prose dark:prose-invert focus:outline-none max-w-full`
          }
        }}
        onUpdate={({ editor }) => {
          onChange(editor.getJSON());
        }}
        slotAfter={<ImageResizer />}
      >
        <EditorCommand className="z-50 h-auto max-h-[330px] overflow-y-auto rounded-md border border-muted bg-background px-1 py-2 shadow-md transition-all">
          <EditorCommandEmpty className="px-2 text-muted-foreground">
            No results
          </EditorCommandEmpty>
          <EditorCommandList>
            {suggestionItems.map((item) => (
              <EditorCommandItem
                value={item.title}
                onCommand={(val) => item.command?.(val)}
                className={`flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent aria-selected:bg-accent `}
                key={item.title}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md border border-muted bg-background">
                  {item.icon}
                </div>
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              </EditorCommandItem>
            ))}
          </EditorCommandList>
        </EditorCommand>

        <EditorBubble
          tippyOptions={{
            placement: "top"
          }}
          className="flex w-fit max-w-[90vw] overflow-hidden rounded-md border border-muted bg-background shadow-xl p-2"
        >
          <Separator orientation="vertical" />
          <NodeSelector open={openNode} onOpenChange={setOpenNode} />
          <Separator orientation="vertical" />

          <LinkSelector open={openLink} onOpenChange={setOpenLink} />
          <Separator orientation="vertical" />
          <TextButtons />
          <Separator orientation="vertical" />
          <ColorSelector open={openColor} onOpenChange={setOpenColor} />
        </EditorBubble>
      </EditorContent>
    </EditorRoot>
  );
};

export default Editor;
