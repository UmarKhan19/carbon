import { cn } from "@carbon/react";
import { useCallback, useRef, useState } from "react";
import type { AssemblyStep, StepMedia } from "~/types/assembly.types";

export interface MediaTabProps {
  step?: AssemblyStep;
  onStepUpdate?: (field: keyof AssemblyStep, value: unknown) => void;
  onUploadMedia?: (file: File) => Promise<StepMedia>;
}

export function MediaTab({ step, onStepUpdate, onUploadMedia }: MediaTabProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mediaIds = step?.mediaIds || [];

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      if (onUploadMedia) {
        setIsUploading(true);
        try {
          for (const file of files) {
            await onUploadMedia(file);
          }
        } finally {
          setIsUploading(false);
        }
      }
    },
    [onUploadMedia]
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      if (onUploadMedia) {
        setIsUploading(true);
        try {
          for (const file of files) {
            await onUploadMedia(file);
          }
        } finally {
          setIsUploading(false);
        }
      }
    },
    [onUploadMedia]
  );

  const handleRemoveMedia = useCallback(
    (mediaId: string) => {
      onStepUpdate?.(
        "mediaIds",
        mediaIds.filter((id) => id !== mediaId)
      );
    },
    [mediaIds, onStepUpdate]
  );

  if (!step) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        Select a step to manage media
      </div>
    );
  }

  return (
    <div className="p-3 flex flex-col h-full">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Step Media ({mediaIds.length})
      </h3>

      {/* Upload Area */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors mb-4",
          isDragging
            ? "border-primary bg-primary/10"
            : "border-border hover:border-muted-foreground"
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,.pdf"
          onChange={handleFileSelect}
          className="hidden"
        />

        {isUploading ? (
          <div className="text-sm text-muted-foreground">
            <div className="animate-spin inline-block w-5 h-5 border-2 border-current border-t-transparent rounded-full mb-2" />
            <div>Uploading...</div>
          </div>
        ) : (
          <>
            <div className="text-2xl mb-2">📁</div>
            <div className="text-sm text-muted-foreground">
              Drop files here or click to upload
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Images, videos, or PDFs
            </div>
          </>
        )}
      </div>

      {/* Media Grid */}
      {mediaIds.length > 0 ? (
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            {mediaIds.map((mediaId) => (
              <div
                key={mediaId}
                className="relative aspect-square bg-muted rounded-lg overflow-hidden group"
              >
                {/* Placeholder - in real implementation, fetch media details */}
                <div className="absolute inset-0 flex items-center justify-center text-3xl">
                  🖼️
                </div>

                {/* Remove button */}
                <button
                  type="button"
                  onClick={() => handleRemoveMedia(mediaId)}
                  className="absolute top-1 right-1 w-6 h-6 bg-destructive text-destructive-foreground rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs"
                >
                  ✕
                </button>

                {/* Media ID label */}
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs p-1 truncate">
                  {mediaId}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          No media attached to this step
        </div>
      )}
    </div>
  );
}
