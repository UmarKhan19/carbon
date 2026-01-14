import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  Spinner
} from "@carbon/react";
import { useState } from "react";
import {
  LuBox,
  LuChevronRight,
  LuCircleAlert,
  LuPackage
} from "react-icons/lu";

/**
 * Assembly node structure from parsed STEP file
 */
interface AssemblyNode {
  id: string;
  name: string;
  partNumber?: string;
  quantity: number;
  children: AssemblyNode[];
}

interface AssemblyMetadataType {
  isAssembly: boolean;
  partCount: number;
  hierarchy: AssemblyNode[];
  rootName?: string;
}

type ParsingStatus = "pending" | "processing" | "completed" | "failed" | null;

interface AssemblyMetadataProps {
  parsingStatus: ParsingStatus;
  assemblyMetadata: AssemblyMetadataType | null;
  parsingError?: string | null;
  className?: string;
}

/**
 * Recursive component to render assembly tree nodes
 */
function AssemblyTreeNode({
  node,
  depth = 0
}: {
  node: AssemblyNode;
  depth?: number;
}) {
  const [isOpen, setIsOpen] = useState(depth < 2); // Auto-expand first 2 levels
  const hasChildren = node.children.length > 0;

  return (
    <div className={cn("text-sm", depth > 0 && "ml-4")}>
      {hasChildren ? (
        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleTrigger className="flex items-center gap-1.5 py-0.5 hover:text-foreground text-muted-foreground w-full text-left">
            <LuChevronRight
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                isOpen && "rotate-90"
              )}
            />
            <LuPackage className="h-3.5 w-3.5 text-primary" />
            <span className="flex-1 truncate">{node.name}</span>
            {node.quantity > 1 && (
              <Badge variant="secondary" className="text-xs px-1.5">
                x{node.quantity}
              </Badge>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent>
            {node.children.map((child, index) => (
              <AssemblyTreeNode
                key={`${child.id}-${index}`}
                node={child}
                depth={depth + 1}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <div className="flex items-center gap-1.5 py-0.5 text-muted-foreground">
          <span className="w-3.5" /> {/* Spacer for alignment */}
          <LuBox className="h-3.5 w-3.5" />
          <span className="flex-1 truncate">{node.name}</span>
          {node.partNumber && (
            <span className="text-xs text-muted-foreground/70">
              {node.partNumber}
            </span>
          )}
          {node.quantity > 1 && (
            <Badge variant="secondary" className="text-xs px-1.5">
              x{node.quantity}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Status badge for parsing status
 */
function ParsingStatusBadge({ status }: { status: ParsingStatus }) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="secondary" className="gap-1">
          Pending
        </Badge>
      );
    case "processing":
      return (
        <Badge
          variant="secondary"
          className="gap-1 bg-blue-500/10 text-blue-600"
        >
          <Spinner className="h-3 w-3" />
          Parsing...
        </Badge>
      );
    case "completed":
      return (
        <Badge
          variant="secondary"
          className="gap-1 bg-green-500/10 text-green-600"
        >
          Parsed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="gap-1">
          <LuCircleAlert className="h-3 w-3" />
          Failed
        </Badge>
      );
    default:
      return null;
  }
}

/**
 * Panel to display assembly metadata from parsed STEP files
 */
export default function AssemblyMetadata({
  parsingStatus,
  assemblyMetadata,
  parsingError,
  className
}: AssemblyMetadataProps) {
  // Don't show anything if there's no parsing status (not a STEP file or not parsed)
  if (!parsingStatus) {
    return null;
  }

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">
            Assembly Structure
          </CardTitle>
          <ParsingStatusBadge status={parsingStatus} />
        </div>
      </CardHeader>
      <CardContent>
        {parsingStatus === "pending" && (
          <p className="text-sm text-muted-foreground">
            Waiting to parse assembly structure...
          </p>
        )}

        {parsingStatus === "processing" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" />
            <span>Analyzing STEP file...</span>
          </div>
        )}

        {parsingStatus === "failed" && (
          <div className="text-sm text-destructive">
            <p>Failed to parse assembly structure.</p>
            {parsingError && (
              <p className="text-xs mt-1 text-muted-foreground">
                {parsingError}
              </p>
            )}
          </div>
        )}

        {parsingStatus === "completed" && assemblyMetadata && (
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <LuPackage className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Type:</span>
                <span className="font-medium">
                  {assemblyMetadata.isAssembly ? "Assembly" : "Part"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <LuBox className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Parts:</span>
                <span className="font-medium">
                  {assemblyMetadata.partCount}
                </span>
              </div>
            </div>

            {assemblyMetadata.isAssembly &&
              assemblyMetadata.hierarchy.length > 0 && (
                <div className="border rounded-md p-2 max-h-64 overflow-y-auto bg-muted/30">
                  {assemblyMetadata.hierarchy.map((node, index) => (
                    <AssemblyTreeNode key={`${node.id}-${index}`} node={node} />
                  ))}
                </div>
              )}

            {!assemblyMetadata.isAssembly && (
              <p className="text-sm text-muted-foreground">
                This is a single part, not an assembly.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
