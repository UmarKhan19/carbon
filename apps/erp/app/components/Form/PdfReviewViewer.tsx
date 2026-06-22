import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

/**
 * Renders a PDF to canvas (react-pdf) and highlights where a given extracted
 * value appears — the "click a field → see it on the document" provenance UX.
 *
 * Bounding boxes are computed entirely client-side from pdfjs `getTextContent()`
 * positions (no vision model, no server change): each text item's transform is
 * mapped into the rendered viewport, and a value is located by sliding over the
 * page's text runs until their joined text contains it.
 */

type ItemBox = { str: string; x: number; y: number; w: number; h: number };
type Highlight = { page: number; x: number; y: number; w: number; h: number };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function unionBox(boxes: ItemBox[]): Omit<Highlight, "page"> {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Find the box for `value` among a page's text items (single item, else a run). */
function findBox(
  items: ItemBox[],
  value: string
): Omit<Highlight, "page"> | null {
  const target = norm(value);
  if (!target) return null;
  // 1) a single item that contains (or equals) the value
  const single = items.find((it) => it.str && norm(it.str).includes(target));
  if (single) return { x: single.x, y: single.y, w: single.w, h: single.h };
  // 2) a consecutive run whose joined text contains the value
  for (let i = 0; i < items.length; i++) {
    let joined = "";
    const run: ItemBox[] = [];
    for (let j = i; j < Math.min(i + 14, items.length); j++) {
      run.push(items[j]);
      joined = norm(`${joined} ${items[j].str}`);
      if (joined.includes(target)) return unionBox(run);
    }
  }
  return null;
}

export function PdfReviewViewer({
  url,
  highlightValue
}: {
  url: string;
  highlightValue?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const itemsByPage = useRef<Record<number, ItemBox[]>>({});
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState<number>();
  const [highlight, setHighlight] = useState<Highlight | null>(null);

  // responsive page width from the container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth - 16);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const captureText = useCallback(
    async (page: any, pageNumber: number) => {
      if (!width) return;
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = width / baseViewport.width;
      const viewport = page.getViewport({ scale });
      const text = await page.getTextContent();
      itemsByPage.current[pageNumber] = text.items
        .filter((it: any) => typeof it.str === "string" && it.str.trim())
        .map((it: any): ItemBox => {
          const tx = (pdfjs as any).Util.transform(
            viewport.transform,
            it.transform
          );
          const h = Math.hypot(tx[2], tx[3]) || it.height * scale;
          const w = it.width * scale;
          return { str: it.str, x: tx[4], y: tx[5] - h, w, h };
        });
    },
    [width]
  );

  // locate + scroll to the highlighted value whenever it (or text) changes
  const locate = useCallback(() => {
    if (!highlightValue) {
      setHighlight(null);
      return;
    }
    for (let p = 1; p <= numPages; p++) {
      const items = itemsByPage.current[p];
      if (!items) continue;
      const box = findBox(items, highlightValue);
      if (box) {
        setHighlight({ page: p, ...box });
        pageRefs.current[p]?.scrollIntoView({
          block: "nearest",
          behavior: "smooth"
        });
        return;
      }
    }
    setHighlight(null);
  }, [highlightValue, numPages]);

  useEffect(() => {
    locate();
  }, [locate]);

  const options = useMemo(() => ({}), []);

  return (
    <div ref={containerRef} className="h-full w-full overflow-auto p-2">
      <Document
        file={url}
        options={options}
        onLoadSuccess={(pdf) => setNumPages(pdf.numPages)}
        loading={
          <div className="py-8 text-center text-sm text-muted-foreground">
            Loading document…
          </div>
        }
        error={
          <div className="py-8 text-center text-sm text-muted-foreground">
            Couldn't render PDF.
          </div>
        }
      >
        {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
          <div
            key={p}
            ref={(el) => {
              pageRefs.current[p] = el;
            }}
            className="relative mb-2 shadow-sm"
          >
            <Page
              pageNumber={p}
              width={width}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              onLoadSuccess={(page) => captureText(page, p)}
              onRenderSuccess={() => locate()}
            />
            {highlight?.page === p && (
              <div
                className="pointer-events-none absolute rounded-sm bg-yellow-300/40 ring-2 ring-yellow-500 transition-all"
                style={{
                  left: highlight.x,
                  top: highlight.y,
                  width: highlight.w,
                  height: highlight.h
                }}
              />
            )}
          </div>
        ))}
      </Document>
    </div>
  );
}
