import type { MentionOptions } from "@tiptap/extension-mention";
import Mention from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import type {
  SuggestionKeyDownProps,
  SuggestionProps
} from "@tiptap/suggestion";
import type { RefObject } from "react";
import tippy, { type Instance, type Props } from "tippy.js";
import type { MentionListRef } from "../components/mention-list";
import { MentionList } from "../components/mention-list";

export interface MentionSuggestion {
  id: string;
  label: string;
  helper?: string;
}

export interface CreateMentionSuggestionOptions {
  /**
   * The trigger character for this mention type (e.g., "@" for users, "#" for tags)
   */
  char: string;
  /**
   * The list of suggestions to show, or a function that returns them
   */
  items: MentionSuggestion[] | (() => MentionSuggestion[]);
  /**
   * Optional ref to the element to append the popup to
   */
  elementRef?: RefObject<Element> | null;
}

export function createMentionSuggestion({
  char,
  items,
  elementRef
}: CreateMentionSuggestionOptions): MentionOptions["suggestion"] {
  return {
    char,
    items: ({ query }) => {
      const itemList = typeof items === "function" ? items() : items;
      return itemList.filter((item) =>
        item.label.toLowerCase().startsWith(query.toLowerCase())
      );
    },
    render: () => {
      let component: ReactRenderer<MentionListRef> | null = null;
      let popup: Instance<Props>[] | null = null;

      return {
        onStart: (props: SuggestionProps<MentionSuggestion>) => {
          component = new ReactRenderer(MentionList, {
            props,
            editor: props.editor
          });

          if (!props.clientRect) {
            return;
          }

          popup = tippy("body", {
            getReferenceClientRect: props.clientRect as () => DOMRect,
            appendTo: () => elementRef?.current ?? document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start"
          });
        },

        onUpdate(props: SuggestionProps<MentionSuggestion>) {
          component?.updateProps(props);

          if (!props.clientRect) {
            return;
          }

          popup?.[0]?.setProps({
            getReferenceClientRect: props.clientRect as () => DOMRect
          });
        },

        onKeyDown(props: SuggestionKeyDownProps) {
          if (props.event.key === "Escape") {
            popup?.[0]?.hide();
            return true;
          }

          return component?.ref?.onKeyDown(props) ?? false;
        },

        onExit() {
          popup?.[0]?.destroy();
          component?.destroy();
        }
      };
    }
  };
}

export interface CreateMentionExtensionOptions {
  /**
   * A unique name for this mention extension (e.g., "item-mention", "customer-mention")
   */
  name: string;
  /**
   * The trigger character for this mention type
   */
  char: string;
  /**
   * The list of suggestions, or a function that returns them
   */
  items: MentionSuggestion[] | (() => MentionSuggestion[]);
  /**
   * Optional ref to append popup to
   */
  elementRef?: RefObject<Element> | null;
}

/**
 * Creates a configured mention extension for a specific type of mention.
 *
 * @example
 * // Create an items mention with @ trigger
 * const ItemMention = createMentionExtension({
 *   name: "item-mention",
 *   char: "@",
 *   items: [
 *     { id: "1", label: "Widget A" },
 *     { id: "2", label: "Widget B" },
 *   ],
 * });
 *
 * @example
 * // Create a customer mention with # trigger
 * const CustomerMention = createMentionExtension({
 *   name: "customer-mention",
 *   char: "#",
 *   items: [
 *     { id: "c1", label: "Acme Corp" },
 *     { id: "c2", label: "Global Inc" },
 *   ],
 * });
 */
export function createMentionExtension({
  name,
  char,
  items,
  elementRef
}: CreateMentionExtensionOptions) {
  return Mention.configure({
    HTMLAttributes: {
      class:
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-status-blue/12 text-status-blue-fg",
      "data-mention-type": name
    },
    suggestion: createMentionSuggestion({ char, items, elementRef })
  }).extend({
    name
  });
}

export { Mention };
