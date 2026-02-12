import { cn } from "@carbon/react";
import type { CSSProperties } from "react";
import { useRef } from "react";

interface ResizeHandleProps {
  columnId: string;
  onResize: (columnId: string, delta: number) => void;
  disabled?: boolean;
}

export const ResizeHandle = ({
  columnId,
  onResize,
  disabled = false
}: ResizeHandleProps) => {
  const handleRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startTimeRef = useRef(0);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return;

    e.preventDefault();
    e.stopPropagation();

    startXRef.current = e.clientX;
    startTimeRef.current = Date.now();

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startXRef.current;
      onResize(columnId, delta);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!disabled && handleRef.current) {
      handleRef.current.style.opacity = "0.6";
    }
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    if (handleRef.current) {
      handleRef.current.style.opacity = "0.2";
    }
  };

  const handleStyle: CSSProperties = {
    position: "absolute",
    right: "-5px",
    top: "0",
    height: "100%",
    width: "10px",
    cursor: disabled ? "default" : "col-resize",
    userSelect: "none",
    touchAction: "none",
    opacity: 0.3
  };

  return (
    <div
      ref={handleRef}
      style={handleStyle}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "bg-border hover:bg-primary group-hover:bg-primary/40 transition-all duration-150",
        disabled && "opacity-0 cursor-not-allowed"
      )}
    />
  );
};
