import { cn, IconButton, Spinner } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { forwardRef, useCallback, useImperativeHandle } from "react";
import { useAudioRecording } from "./hooks/useAudioRecording";
import { useChatStore } from "./lib/store";

// Custom Record Icon with smooth animation
const RecordIcon = ({
  size = 16,
  isRecording = false
}: {
  size?: number;
  isRecording?: boolean;
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Recreate the Material Design MdOutlineGraphicEq icon with individual bars for wave-like animation */}

      {/* Bar 1 (leftmost, shortest) */}
      <rect x="3" y="10" width="2" height="4" fill="currentColor">
        {isRecording && (
          <>
            <animate
              attributeName="height"
              values="4;2;6;3;8;1;5;2;7;4"
              dur="2.4s"
              repeatCount="indefinite"
              begin="0s"
            />
            <animate
              attributeName="y"
              values="10;11;7;10.5;6;11.5;8.5;11;6.5;10"
              dur="2.4s"
              repeatCount="indefinite"
              begin="0s"
            />
          </>
        )}
      </rect>

      {/* Bar 2 (second from left) */}
      <rect x="7" y="6" width="2" height="12" fill="currentColor">
        {isRecording && (
          <>
            <animate
              attributeName="height"
              values="12;8;16;10;18;6;14;9;15;12"
              dur="2.7s"
              repeatCount="indefinite"
              begin="0.45s"
            />
            <animate
              attributeName="y"
              values="6;8;2;7;1;9;5;7.5;4.5;6"
              dur="2.7s"
              repeatCount="indefinite"
              begin="0.45s"
            />
          </>
        )}
      </rect>

      {/* Bar 3 (center, tallest) */}
      <rect x="11" y="2" width="2" height="20" fill="currentColor">
        {isRecording && (
          <>
            <animate
              attributeName="height"
              values="20;14;22;16;24;12;18;15;21;20"
              dur="2.1s"
              repeatCount="indefinite"
              begin="0.9s"
            />
            <animate
              attributeName="y"
              values="2;5;1;4;0;6;3;4.5;1.5;2"
              dur="2.1s"
              repeatCount="indefinite"
              begin="0.9s"
            />
          </>
        )}
      </rect>

      {/* Bar 4 (second from right) */}
      <rect x="15" y="6" width="2" height="12" fill="currentColor">
        {isRecording && (
          <>
            <animate
              attributeName="height"
              values="12;16;8;14;10;18;6;13;9;12"
              dur="3.3s"
              repeatCount="indefinite"
              begin="1.35s"
            />
            <animate
              attributeName="y"
              values="6;2;8;5;7;1;9;5.5;7.5;6"
              dur="3.3s"
              repeatCount="indefinite"
              begin="1.35s"
            />
          </>
        )}
      </rect>

      {/* Bar 5 (rightmost) */}
      <rect x="19" y="10" width="2" height="4" fill="currentColor">
        {isRecording && (
          <>
            <animate
              attributeName="height"
              values="4;6;2;7;3;8;1;5;3;4"
              dur="3.0s"
              repeatCount="indefinite"
              begin="1.8s"
            />
            <animate
              attributeName="y"
              values="10;7;11;6.5;10.5;6;11.5;8.5;10.5;10"
              dur="3.0s"
              repeatCount="indefinite"
              begin="1.8s"
            />
          </>
        )}
      </rect>
    </svg>
  );
};

export interface RecordButtonProps {
  disabled?: boolean;
  className?: string;
  size?: number;
}

export interface RecordButtonRef {
  handleRecordClick: () => void;
}

export const RecordButton = forwardRef<RecordButtonRef, RecordButtonProps>(
  function RecordButton({ disabled = false, className, size = 16 }, ref) {
    const { t } = useLingui();
    const {
      input,
      setInput,
      isRecording,
      isProcessing,
      setIsRecording,
      setIsProcessing
    } = useChatStore();
    const { startRecording, stopRecording, transcribeAudio } =
      useAudioRecording();

    const handleRecordClick = useCallback(async () => {
      if (isRecording) {
        // Stop recording and transcribe
        try {
          setIsProcessing(true);
          const audioBlob = await stopRecording();

          if (audioBlob) {
            const transcribedText = await transcribeAudio(audioBlob);

            if (transcribedText.trim()) {
              setInput(input ? `${input} ${transcribedText}` : transcribedText);
            }
          }
        } catch (error) {
          console.error("Failed to process recording:", error);
        } finally {
          setIsRecording(false);
          setIsProcessing(false);
        }
      } else {
        // Start recording and reset input
        try {
          setInput(""); // Reset input when starting to record
          await startRecording();
          setIsRecording(true);
        } catch (error) {
          console.error("Failed to start recording:", error);
        }
      }
    }, [
      isRecording,
      stopRecording,
      startRecording,
      transcribeAudio,
      setInput,
      input,
      setIsRecording,
      setIsProcessing
    ]);

    // Expose the handleRecordClick method via ref
    useImperativeHandle(ref, () => ({
      handleRecordClick
    }));

    return (
      <IconButton
        aria-label={t`Record`}
        variant="ghost"
        isRound
        icon={
          isProcessing ? <Spinner /> : <RecordIcon isRecording={isRecording} />
        }
        isDisabled={isProcessing}
        onClick={handleRecordClick}
        disabled={disabled}
        className={cn(
          isRecording &&
            "text-indigo-600 hover:text-indigo-600 [&_svg]:text-indigo-600 [&_svg]:hover:text-indigo-600",
          disabled && "opacity-50",
          className
        )}
      />
    );
  }
);
