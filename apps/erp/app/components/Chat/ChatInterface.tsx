import { useArtifacts } from "@ai-sdk-tools/artifacts/client";
import { useChat, useChatActions, useDataPart } from "@ai-sdk-tools/store";
import { useCarbon } from "@carbon/auth";
import { cn } from "@carbon/react";
import { useLocale } from "@react-aria/i18n";
import { DefaultChatTransport, generateId } from "ai";
import { useEffect, useMemo, useRef } from "react";
import { Greeting } from "~/components/Greeting";
import { useUser } from "~/hooks";
import { path } from "~/utils/path";
import { Canvas } from "./Canvas";
import { ChatHeader } from "./ChatHeader";
import type { ChatInputMessage } from "./ChatInput";
import { ChatInput } from "./ChatInput";
import { ChatMessages } from "./ChatMessages";
import { ChatStatusIndicators } from "./ChatStatusIndicators";
import { ChatWidgets } from "./ChatWidgets";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton
} from "./Conversation";
import { useChatInterface } from "./hooks/useChatInterface";
import { useChatStatus } from "./hooks/useChatStatus";
import type { UIChatMessage } from "./lib/types";
import type { RecordButtonRef } from "./RecordButton";

type Props = {
  geo?: {
    city?: string;
    country?: string;
  };
};

export function ChatInterface({ geo }: Props) {
  const { chatId: routeChatId } = useChatInterface();
  const recordButtonRef = useRef<RecordButtonRef>(null);

  const chatId = useMemo(() => routeChatId ?? generateId(), [routeChatId]);
  const { reset } = useChatActions();
  const prevChatIdRef = useRef<string | null>(routeChatId);
  const [, clearSuggestions] = useDataPart<{ prompts: string[] }>(
    "suggestions"
  );

  // Reset chat state when navigating away from a chat (sidebar, browser back, etc.)
  useEffect(() => {
    const prevChatId = prevChatIdRef.current;
    const currentChatId = routeChatId;

    // If we had a chatId before and now we don't (navigated away), reset
    // Or if we're switching to a different chatId, reset
    if (prevChatId && prevChatId !== currentChatId) {
      reset();
      clearSuggestions();
    }

    // Update the ref for next comparison
    prevChatIdRef.current = currentChatId;
  }, [routeChatId, reset, clearSuggestions]);

  const { locale } = useLocale();
  const { accessToken } = useCarbon();
  const {
    id: userId,
    firstName,
    lastName,
    company: {
      id: companyId,
      name: companyName,
      baseCurrencyCode: baseCurrency
    }
  } = useUser();

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const authenticatedFetch = useMemo(
    () =>
      Object.assign(
        async (url: RequestInfo | URL, requestOptions?: RequestInit) => {
          return fetch(url, {
            ...requestOptions,
            headers: {
              ...requestOptions?.headers,
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "x-company-id": companyId,
              "x-user-id": userId
            }
          });
        }
      ),

    [accessToken]
  );

  const { messages, status } = useChat<UIChatMessage>({
    id: chatId,
    transport: new DefaultChatTransport({
      api: path.to.api.chat,
      fetch: authenticatedFetch,
      prepareSendMessagesRequest({ messages, id }) {
        const lastMessage = messages[messages.length - 1] as ChatInputMessage;

        const agentChoice = lastMessage.metadata?.agentChoice;
        const toolChoice = lastMessage.metadata?.toolChoice;

        return {
          body: {
            id,
            fullName: `${firstName} ${lastName}`,
            companyName,
            baseCurrency: baseCurrency ?? "USD",
            country: geo?.country,
            city: geo?.city,
            message: lastMessage,
            agentChoice,
            toolChoice,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            locale
          }
        };
      }
    })
  });

  const { agentStatus, currentToolCall } = useChatStatus(messages, status);

  // @ts-expect-error TS2339 - TODO: fix type
  const { artifacts } = useArtifacts();
  const hasArtifacts = artifacts && artifacts.length > 0;
  const hasMessages = messages.length > 0;

  const [suggestions] = useDataPart<{ prompts: string[] }>("suggestions");
  const hasSuggestions = suggestions?.prompts && suggestions.prompts.length > 0;

  return (
    <div className="relative flex size-full overflow-hidden bg-background h-[calc(100dvh-49px)]">
      {/* Canvas slides in from right when artifacts are present */}
      <div
        className={cn(
          "fixed right-0 top-0 bottom-0 z-20",
          hasArtifacts ? "translate-x-0" : "translate-x-full",
          hasMessages && "transition-transform duration-300 ease-in-out"
        )}
      >
        {hasArtifacts && <Canvas />}
      </div>

      {/* Main chat area - container that slides left when canvas opens */}
      <div
        className={cn(
          "relative flex-1",
          hasMessages && "transition-all duration-300 ease-in-out",
          hasArtifacts && "mr-[600px]",
          !hasMessages && "flex items-center justify-center"
        )}
      >
        {hasMessages && (
          <>
            {/* Conversation view - messages with absolute positioning for proper height */}
            <div className="absolute inset-0 flex flex-col">
              <div
                className={cn(
                  "sticky top-0 left-0 z-10 shrink-0",
                  hasMessages && "transition-all duration-300 ease-in-out",
                  hasArtifacts ? "right-[600px]" : "right-0"
                )}
              >
                <div className="bg-background/80 dark:bg-background/50 backdrop-blur-sm p-2 border-b">
                  <ChatHeader />
                </div>
              </div>
              <Conversation>
                <ConversationContent className="pb-48 pt-14">
                  <div className="max-w-2xl mx-auto w-full">
                    <ChatMessages
                      messages={messages}
                      isStreaming={
                        status === "streaming" || status === "submitted"
                      }
                    />
                    <ChatStatusIndicators
                      agentStatus={agentStatus}
                      currentToolCall={currentToolCall}
                      status={status}
                    />
                  </div>
                </ConversationContent>
                <ConversationScrollButton
                  className={cn(hasSuggestions ? "bottom-52" : "bottom-42")}
                />
              </Conversation>
            </div>
          </>
        )}

        {/* Fixed input at bottom - respects parent container boundaries */}
        <div
          className={cn(
            "transition-all duration-300 ease-in-out max-w-2xl mx-auto px-6",
            hasMessages
              ? "absolute bottom-0 left-0"
              : "w-full -mt-[20dvh] flex flex-col gap-8 items-center justify-center",
            hasArtifacts ? "right-[600px]" : "right-0"
          )}
        >
          {!hasMessages && <Greeting size="h1" className="font-medium" />}
          <div className="w-full pb-2">
            <ChatInput ref={recordButtonRef} hasMessages={hasMessages} />
          </div>

          {!hasMessages && <ChatWidgets recordButtonRef={recordButtonRef} />}
        </div>
      </div>
    </div>
  );
}
