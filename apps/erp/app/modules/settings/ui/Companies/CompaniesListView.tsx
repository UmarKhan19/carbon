import { IconButton } from "@carbon/react";
import { LuBuilding2, LuChevronRight, LuPlus, LuTrash2 } from "react-icons/lu";
import type { Company } from "../../types";

interface CompaniesListViewProps {
  companies: Company[];
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
}

function CompaniesRow({
  company,
  companies,
  depth,
  onDelete,
  onAddChild
}: {
  company: Company;
  companies: Company[];
  depth: number;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
}) {
  const children = companies.filter((s) => s.parentCompanyId === company.id);
  const isElimination = company.isEliminationEntity;

  return (
    <div>
      <div
        className="group flex items-center gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-accent/50"
        style={{ paddingLeft: `${depth * 28 + 16}px` }}
      >
        {children.length > 0 ? (
          <LuChevronRight className="size-4 text-muted-foreground" />
        ) : (
          <div className="size-4" />
        )}

        <div className="flex size-8 shrink-0 items-center justify-center bg-muted">
          <LuBuilding2 className="size-3.5 text-muted-foreground" />
        </div>

        <div className="flex flex-col gap-0 min-w-0">
          <span
            className={`text-sm font-medium ${
              isElimination ? "text-muted-foreground" : "text-foreground"
            }`}
          >
            {company.name}
          </span>
          <span className="text-xs text-muted-foreground">
            {company.baseCurrencyCode}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!isElimination && (
            <IconButton
              variant="ghost"
              size="sm"
              onClick={() => onAddChild(company.id!)}
              aria-label="Add company"
              icon={<LuPlus />}
            />
          )}

          {company.parentCompanyId && (
            <IconButton
              variant="ghost"
              size="sm"
              onClick={() => onDelete(company.id!)}
              aria-label="Delete"
              icon={<LuTrash2 />}
              className="text-destructive hover:text-destructive"
            />
          )}
        </div>
      </div>

      {children.map((child) => (
        <CompaniesRow
          key={child.id}
          company={child}
          companies={companies}
          depth={depth + 1}
          onDelete={onDelete}
          onAddChild={onAddChild}
        />
      ))}
    </div>
  );
}

export function CompaniesListView({
  companies,
  onDelete,
  onAddChild
}: CompaniesListViewProps) {
  const roots = companies.filter((s) => s.parentCompanyId === null);

  return (
    <div className="bg-card overflow-hidden">
      <div className="grid grid-cols-[1fr_auto] items-center border-b border-border bg-muted/50 px-4 py-2.5">
        <span className="text-xs font-medium text-muted-foreground">
          Company
        </span>
        <span className="text-xs font-medium text-muted-foreground">
          Actions
        </span>
      </div>
      {roots.map((root) => (
        <CompaniesRow
          key={root.id}
          company={root}
          companies={companies}
          depth={0}
          onDelete={onDelete}
          onAddChild={onAddChild}
        />
      ))}
    </div>
  );
}
