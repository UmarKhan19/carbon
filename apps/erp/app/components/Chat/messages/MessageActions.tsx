import { useChatActions, useChatId } from "@ai-sdk-tools/store";
import {
  cn,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { motion } from "framer-motion";
import { useState } from "react";
import {
  LuCheck,
  LuCopy,
  LuRefreshCcw,
  LuThumbsDown,
  LuThumbsUp
} from "react-icons/lu";
import { useFetcher } from "react-router";

interface MessageActionsProps {
  messageId: string;
  messageContent: string;
}

export function MessageActions({
  messageId,
  messageContent
}: MessageActionsProps) {
  const { t } = useLingui();
  const chatId = useChatId();
  const { regenerate } = useChatActions();
  const [feedbackGiven, setFeedbackGiven] = useState<
    "positive" | "negative" | null
  >(null);
  const [copied, setCopied] = useState(false);

  const feedbackFetcher = useFetcher<{}>();

  const handleRegenerate = () => {
    regenerate?.();
  };

  const handlePositive = () => {
    if (feedbackGiven === "positive") {
      // Already gave positive feedback, remove feedback
      setFeedbackGiven(null);
      return;
    }

    setFeedbackGiven("positive");

    if (!chatId) return;

    alert(t`Positive feedback`);
  };

  const handleNegative = () => {
    if (feedbackGiven === "negative") {
      // Already gave negative feedback, remove feedback
      setFeedbackGiven(null);
      return;
    }

    setFeedbackGiven("negative");

    if (!chatId) return;

    alert(t`Negative feedback`);
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(messageContent);
      setCopied(true);
      // Reset the copied state after 2 seconds
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
    }
  };

  return (
    <motion.div
      className="flex items-center gap-1 mt-3"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        ease: "easeOut",
        staggerChildren: 0.05
      }}
    >
      {/* Copy Button */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={copyToClipboard}
                className="flex items-center justify-center w-6 h-6 transition-colors duration-200 hover:bg-muted"
              >
                {copied ? (
                  <LuCheck className="size-3.5 animate-in zoom-in-50 duration-200" />
                ) : (
                  <LuCopy className="size-3 text-muted-foreground hover:text-foreground" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent className="px-2 py-1 text-xs">
              <p>
                {copied ? <Trans>Copied!</Trans> : <Trans>Copy response</Trans>}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </motion.div>

      {/* Retry Button */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleRegenerate}
                className="flex items-center justify-center w-6 h-6 transition-colors duration-200 hover:bg-muted"
              >
                <LuRefreshCcw className="size-3.5 text-muted-foreground hover:text-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="px-2 py-1 text-xs">
              <p>
                <Trans>Retry response</Trans>
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </motion.div>

      {/* Positive Feedback Button */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handlePositive}
                disabled={feedbackFetcher.state !== "idle"}
                className={cn(
                  "flex items-center justify-center w-6 h-6 transition-colors duration-200 hover:bg-muted",
                  feedbackFetcher.state !== "idle" &&
                    "opacity-50 cursor-not-allowed"
                )}
              >
                <LuThumbsUp
                  className={cn(
                    "w-3 h-3",
                    feedbackGiven === "positive"
                      ? "text-emerald-600"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent className="px-2 py-1 text-xs">
              <p>
                {feedbackGiven === "positive" ? (
                  <Trans>Remove positive feedback</Trans>
                ) : (
                  <Trans>Positive feedback</Trans>
                )}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </motion.div>

      {/* Negative Feedback Button */}
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleNegative}
                disabled={feedbackFetcher.state !== "idle"}
                className={cn(
                  "flex items-center justify-center w-6 h-6 transition-colors duration-200 hover:bg-muted",
                  feedbackFetcher.state !== "idle" &&
                    "opacity-50 cursor-not-allowed"
                )}
              >
                <LuThumbsDown
                  className={cn(
                    "w-3 h-3",
                    feedbackGiven === "negative"
                      ? "text-red-600"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent className="px-2 py-1 text-xs">
              <p>
                {feedbackGiven === "negative" ? (
                  <Trans>Remove negative feedback</Trans>
                ) : (
                  <Trans>Negative feedback</Trans>
                )}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </motion.div>
    </motion.div>
  );
}
