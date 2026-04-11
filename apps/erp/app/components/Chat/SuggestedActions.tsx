import { useChatActions, useChatId } from "@ai-sdk-tools/store";
import { cn, IconButton } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuZap } from "react-icons/lu";
import { useChatStore } from "./lib/store";

type SuggestedAction = {
  id: string;
  toolName: string;
  toolParams: Record<string, any>;
  text: string;
};

export function SuggestedActions() {
  const { sendMessage } = useChatActions();
  const chatId = useChatId();

  const handleToolCall = (params: {
    toolName: string;
    toolParams: Record<string, any>;
    text: string;
  }) => {
    if (!chatId) return;

    sendMessage({
      role: "user",
      parts: [{ type: "text", text: params.text }],
      metadata: {
        toolCall: {
          toolName: params.toolName,
          toolParams: params.toolParams
        }
      }
    });
  };

  // UI configuration based on action ID
  const uiConfig: Record<
    string,
    {
      icon: React.ComponentType<any>;
      title: string;
      description: string;
    }
  > = {
    // "get-runway": {
    //   icon: Icons.Speed,
    //   title: "Runway",
    //   description: "Show me my runway",
    // },
  };

  const suggestedActions: SuggestedAction[] = [];

  return (
    <div className="w-full px-6 mt-10 mb-8 flex items-center justify-center">
      <div className="flex gap-3 overflow-x-auto scrollbar-hide">
        {suggestedActions.map((action) => {
          const config = uiConfig[action.id];
          const Icon = config?.icon;
          const title = config?.title || action.id;
          const description =
            config?.description || `Execute ${action.toolName}`;

          return (
            <button
              key={action.id}
              type="button"
              className={cn(
                "border border-border hover:bg-accent hover:border-border-hover",
                "px-3 py-2 flex items-center gap-2 cursor-pointer",
                "transition-all duration-300 min-w-fit whitespace-nowrap"
              )}
              onClick={() => {
                handleToolCall({
                  toolName: action.toolName,
                  toolParams: action.toolParams,
                  text: description
                });
              }}
            >
              {Icon && <Icon className="w-4 h-4 text-muted-foreground" />}
              <span className="text-foreground text-[12px] font-medium">
                {title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SuggestedActionsButton() {
  const { t } = useLingui();
  const { showCommands, setShowCommands } = useChatStore();

  const handleClick = (e: React.MouseEvent) => {
    // Prevent the click from bubbling up and being detected as an "outside click"
    e.stopPropagation();

    // Toggle the command menu
    setShowCommands(!showCommands);

    // Focus textarea for keyboard navigation when opening
    if (!showCommands) {
      requestAnimationFrame(() => {
        document.querySelector("textarea")?.focus();
      });
    }
  };

  return (
    <IconButton
      aria-label={t`Suggested Actions`}
      icon={<LuZap />}
      variant="ghost"
      type="button"
      onClick={handleClick}
      className={cn(
        showCommands
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
      // Add data attribute to help identify this button for exclusion from outside clicks
      data-suggested-actions-toggle
    />
  );
}
