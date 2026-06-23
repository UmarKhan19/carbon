import {
  Badge,
  Button,
  Count,
  cn,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Tabs,
  TabsList,
  TabsTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import Papa from "papaparse";
import { useMemo, useState } from "react";
import { LuCircleCheck, LuCircleX, LuDownload } from "react-icons/lu";

type ImportResult = {
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
};

type RowFilter = "all" | "valid" | "errors";

type ImportResultsModalProps = {
  table: string;
  result: ImportResult;
  // Every parsed CSV data row, keyed by column header (the wizard's `firstRows`,
  // which holds the full file — not a sample). Row index aligns with the edge
  // function's per-row `errors[].row`, so we can mark each row valid/error.
  rows: Record<string, string>[];
  columns: string[];
  onClose: () => void;
};

export const ImportResultsModal = ({
  table,
  result,
  rows,
  columns,
  onClose
}: ImportResultsModalProps) => {
  const { t } = useLingui();
  const [filter, setFilter] = useState<RowFilter>("all");

  const reasonByRow = useMemo(() => {
    const map = new Map<number, string>();
    for (const error of result.errors ?? []) map.set(error.row, error.reason);
    return map;
  }, [result.errors]);

  const classified = useMemo(
    () =>
      rows.map((data, index) => ({
        index,
        data,
        reason: reasonByRow.get(index),
        isError: reasonByRow.has(index)
      })),
    [rows, reasonByRow]
  );

  const errorCount = reasonByRow.size;
  const validCount = rows.length - errorCount;

  const visibleRows = classified.filter((row) =>
    filter === "errors" ? row.isError : filter === "valid" ? !row.isError : true
  );

  // The CSV is already uploaded; the user just needs the failed rows back to fix
  // and re-import. Re-emit the original column values for error rows only.
  const downloadInvalidRows = () => {
    const invalid = classified
      .filter((row) => row.isError)
      .map((row) => columns.map((column) => row.data[column] ?? ""));
    const csv = Papa.unparse({ fields: columns, data: invalid });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${table}-import-errors.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent
        size="xxlarge"
        onInteractOutside={(e) => e.preventDefault()}
        className="min-w-0"
      >
        <ModalHeader>
          <ModalTitle>
            <Trans>Import results</Trans>
          </ModalTitle>
          <ModalDescription>
            {errorCount > 0 ? (
              <Trans>
                {result.inserted} inserted, {result.updated} updated —{" "}
                {errorCount} row(s) need fixing.
              </Trans>
            ) : (
              <Trans>
                All {rows.length} row(s) imported — {result.inserted} inserted,{" "}
                {result.updated} updated.
              </Trans>
            )}
          </ModalDescription>
        </ModalHeader>
        <ModalBody className="min-w-0">
          <div className="flex items-center justify-between gap-4">
            <Tabs
              value={filter}
              onValueChange={(value) => setFilter(value as RowFilter)}
            >
              <TabsList>
                <TabsTrigger value="all" className="gap-1.5">
                  <Trans>All</Trans>
                  <Count count={rows.length} />
                </TabsTrigger>
                <TabsTrigger value="valid" className="gap-1.5">
                  <Trans>Valid</Trans>
                  <Count count={validCount} />
                </TabsTrigger>
                <TabsTrigger value="errors" className="gap-1.5">
                  <Trans>Errors</Trans>
                  <Count count={errorCount} />
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {errorCount > 0 && (
              <Button
                variant="secondary"
                size="md"
                leftIcon={<LuDownload />}
                onClick={downloadInvalidRows}
              >
                <Trans>Download {errorCount} invalid row(s)</Trans>
              </Button>
            )}
          </div>

          <div className="mt-4 w-full min-w-0 max-h-[420px] overflow-auto rounded-md border border-border">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="w-10 px-3 py-2 font-medium" />
                  {columns.map((column) => (
                    <th
                      key={column}
                      className="whitespace-nowrap px-3 py-2 font-medium"
                    >
                      {column}
                    </th>
                  ))}
                  <th className="whitespace-nowrap px-3 py-2 font-medium">
                    <Trans>Result</Trans>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    key={row.index}
                    className={cn(
                      "border-b border-border last:border-0",
                      row.isError && "bg-destructive/5"
                    )}
                  >
                    <td className="px-3 py-2 align-top">
                      {row.isError ? (
                        <LuCircleX className="h-4 w-4 text-destructive" />
                      ) : (
                        <LuCircleCheck className="h-4 w-4 text-emerald-500" />
                      )}
                    </td>
                    {columns.map((column) => (
                      <td
                        key={column}
                        className="max-w-48 truncate px-3 py-2 align-top"
                        title={row.data[column]}
                      >
                        {row.data[column]}
                      </td>
                    ))}
                    <td className="px-3 py-2 align-top">
                      {row.isError ? (
                        <span className="text-destructive">{row.reason}</span>
                      ) : (
                        <Badge variant="secondary">
                          <Trans>Imported</Trans>
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={columns.length + 2}
                      className="px-3 py-8 text-center text-muted-foreground"
                    >
                      <Trans>No rows to show.</Trans>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose}>{t`Done`}</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
