import { cn } from "@carbon/react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { getItemDetailPath } from "~/utils/path";

// Renders an item reference (id/name) as a link to the item's detail page,
// opened in a NEW TAB so the change order stays put. `type` picks the right
// detail route (defaults to Part for assemblies/unknown types).
export default function ItemLink({
  itemId,
  type,
  children,
  className
}: {
  itemId: string;
  type: string | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={getItemDetailPath(type, itemId)}
      target="_blank"
      rel="noopener noreferrer"
      prefetch="intent"
      className={cn("hover:underline", className)}
    >
      {children}
    </Link>
  );
}
