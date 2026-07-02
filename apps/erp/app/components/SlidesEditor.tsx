import { Button, cn, IconButton, Label, VStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCirclePlus, LuMapPin, LuX } from "react-icons/lu";
import type { SlideAnnotation, SlideSize } from "~/modules/shared";
import { slideSizes } from "~/modules/shared";
import { getPrivateUrl } from "~/utils/path";
import { SlideAnnotator } from "./SlideAnnotator";

// Card width + image height per display size — drives the resizable gallery grid.
const SLIDE_CARD_WIDTH: Record<SlideSize, string> = {
  small: "w-28",
  medium: "w-40",
  large: "w-56"
};
const SLIDE_IMAGE_HEIGHT: Record<SlideSize, string> = {
  small: "h-20",
  medium: "h-28",
  large: "h-40"
};
const SLIDE_SIZE_LABEL: Record<SlideSize, string> = {
  small: "S",
  medium: "M",
  large: "L"
};

export type EditorSlide = {
  key: string;
  imagePath: string;
  caption: string | null;
  size: SlideSize | null;
  annotations: SlideAnnotation[] | null;
};

// Presentational slides grid — header + "Add slide" + cards (image · pins · size · caption).
// Shared by the create form (draft buffer, attached after the step is saved) and the edit
// form (persisted immediately via the slide routes). Used by both the item method editor
// (BillOfProcess) and the job editor (JobBillOfProcess). See PRD-step-reference-images.
export function SlidesEditor({
  slides,
  toolOptions = [],
  isDisabled,
  busy,
  fileInputRef,
  onFileChange,
  onRemove,
  onCaptionBlur,
  onSizeChange,
  onAnnotationsChange
}: {
  slides: EditorSlide[];
  toolOptions?: { id: string; name: string }[];
  isDisabled: boolean;
  busy: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
  onCaptionBlur: (index: number, caption: string) => void;
  onSizeChange: (index: number, size: SlideSize) => void;
  onAnnotationsChange: (index: number, annotations: SlideAnnotation[]) => void;
}) {
  const { t } = useLingui();
  const [annotatingIndex, setAnnotatingIndex] = useState<number | null>(null);
  const annotating = annotatingIndex == null ? null : slides[annotatingIndex];

  if (isDisabled && slides.length === 0) return null;

  return (
    <VStack spacing={2} className="w-full col-span-2 border-t pt-4">
      <div className="flex w-full items-center justify-between">
        <Label className="text-xs text-muted-foreground">Slides</Label>
        {!isDisabled && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onFileChange}
            />
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<LuCirclePlus />}
              isLoading={busy}
              isDisabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              Add slide
            </Button>
          </>
        )}
      </div>
      {slides.length === 0 ? (
        <p className="w-full text-xs text-muted-foreground">No slides</p>
      ) : (
        <div className="flex w-full flex-wrap items-start gap-3">
          {slides.map((slide, index) => {
            const size = slide.size ?? "medium";
            const pins = slide.annotations ?? [];
            return (
              <div
                key={slide.key}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border p-2",
                  SLIDE_CARD_WIDTH[size]
                )}
              >
                <div className="relative">
                  <img
                    src={getPrivateUrl(slide.imagePath)}
                    alt={slide.caption ?? "Slide"}
                    className={cn(
                      "w-full rounded-md bg-muted/40 object-contain",
                      SLIDE_IMAGE_HEIGHT[size]
                    )}
                  />
                  {/* Read-only pin preview so an annotated slide reads at a glance. */}
                  {pins.map((pin, i) => (
                    <span
                      key={pin.id}
                      className="pointer-events-none absolute flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white text-[8px] font-semibold text-white shadow"
                      style={{
                        left: `${pin.x * 100}%`,
                        top: `${pin.y * 100}%`,
                        backgroundColor: pin.color ?? "#ef4444"
                      }}
                    >
                      {i + 1}
                    </span>
                  ))}
                  {!isDisabled && (
                    <IconButton
                      aria-label={t`Remove slide`}
                      icon={<LuX />}
                      variant="secondary"
                      size="sm"
                      className="absolute right-1 top-1"
                      onClick={() => onRemove(index)}
                    />
                  )}
                </div>
                {!isDisabled && (
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-0.5">
                      {slideSizes.map((s) => (
                        <Button
                          key={s}
                          variant={size === s ? "active" : "ghost"}
                          size="sm"
                          className="h-6 w-6 p-0 text-[10px]"
                          onClick={() => onSizeChange(index, s)}
                        >
                          {SLIDE_SIZE_LABEL[s]}
                        </Button>
                      ))}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      leftIcon={<LuMapPin className="size-3" />}
                      onClick={() => setAnnotatingIndex(index)}
                    >
                      {pins.length > 0 ? pins.length : t`Pin`}
                    </Button>
                  </div>
                )}
                <input
                  type="text"
                  aria-label={t`Caption`}
                  placeholder={t`Caption`}
                  defaultValue={slide.caption ?? ""}
                  disabled={isDisabled}
                  onBlur={(e) => onCaptionBlur(index, e.target.value)}
                  className="w-full rounded-md border bg-transparent px-2 py-1 text-xs"
                />
              </div>
            );
          })}
        </div>
      )}

      {annotating && annotatingIndex != null && (
        <SlideAnnotator
          open
          imageUrl={getPrivateUrl(annotating.imagePath)}
          initial={annotating.annotations ?? []}
          toolOptions={toolOptions}
          onSave={(next) => {
            onAnnotationsChange(annotatingIndex, next);
            setAnnotatingIndex(null);
          }}
          onClose={() => setAnnotatingIndex(null)}
        />
      )}
    </VStack>
  );
}
