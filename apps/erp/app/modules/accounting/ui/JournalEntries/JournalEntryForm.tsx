import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  useDisclosure,
  VStack
} from "@carbon/react";
import { useCallback, useMemo, useState } from "react";
import {
  LuCheckCheck,
  LuCircleAlert,
  LuCircleCheck,
  LuEllipsisVertical,
  LuPlus,
  LuRotateCcw,
  LuSave,
  LuTrash
} from "react-icons/lu";
import { Link, useFetcher, useNavigate } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import { DatePicker, Hidden, Input, Select } from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import { path } from "~/utils/path";
import {
  journalEntrySourceTypes,
  journalEntryValidator
} from "../../accounting.models";
import JournalEntryStatus from "./JournalEntryStatus";
import JournalLineRow from "./JournalLineRow";
import type { ClientJournalLine } from "./types";

type JournalEntryFormProps = {
  journalEntryId: string;
  displayId: string;
  status: string;
  sourceType: string;
  reversedById?: string | null;
  initialValues: {
    id: string;
    companyId: string;
    sourceType: string;
    postingDate: string;
    description: string;
  };
  initialLines: ClientJournalLine[];
  companies: { id: string; name: string }[];
  isDisabled?: boolean;
};

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

function createEmptyLine(): ClientJournalLine {
  return {
    id: generateId(),
    accountNumber: "",
    description: "",
    debit: null,
    credit: null
  };
}

const JournalEntryForm = ({
  journalEntryId,
  displayId,
  status,
  sourceType,
  reversedById,
  initialValues,
  initialLines,
  companies,
  isDisabled = false
}: JournalEntryFormProps) => {
  const reverseFetcher = useFetcher();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const deleteModal = useDisclosure();
  const reverseModal = useDisclosure();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });

  const [lines, setLines] = useState<ClientJournalLine[]>(
    initialLines.length > 0
      ? initialLines
      : [createEmptyLine(), createEmptyLine()]
  );
  const isDraft = status === "Draft";
  const isPosted = status === "Posted";
  const isReversed = status === "Reversed";

  const companyName = useMemo(
    () => companies.find((c) => c.id === initialValues.companyId)?.name ?? "",
    [companies, initialValues.companyId]
  );

  const sourceTypeOptions = journalEntrySourceTypes.map((type) => ({
    label: <Enumerable value={type} />,
    value: type
  }));

  const totalDebits = lines.reduce((sum, line) => sum + (line.debit || 0), 0);
  const totalCredits = lines.reduce((sum, line) => sum + (line.credit || 0), 0);
  const difference = totalDebits - totalCredits;
  const isBalanced = Math.abs(difference) < 0.01;

  const handleLineChange = useCallback(
    (index: number, updatedLine: ClientJournalLine) => {
      setLines((prev) => {
        const newLines = [...prev];
        newLines[index] = updatedLine;
        return newLines;
      });
    },
    []
  );

  const handleDeleteLine = useCallback((index: number) => {
    setLines((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleAddLine = useCallback(() => {
    setLines((prev) => [...prev, createEmptyLine()]);
  }, []);

  const linesJson = JSON.stringify(
    lines.map((l) => ({
      accountNumber: l.accountNumber,
      description: l.description,
      debit: l.debit ?? 0,
      credit: l.credit ?? 0
    }))
  );

  return (
    <>
      <Card>
        <ValidatedForm
          method="post"
          validator={journalEntryValidator}
          defaultValues={initialValues}
          isReadOnly={isDisabled}
          style={{ width: "100%" }}
        >
          <CardHeader className="flex-row items-center justify-between">
            <HStack>
              <Heading as="h1" size="h3">
                {displayId}
              </Heading>
              <Copy text={displayId} />

              {isDraft && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      aria-label="More options"
                      icon={<LuEllipsisVertical />}
                      variant="secondary"
                      size="sm"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={
                        !permissions.can("delete", "accounting") ||
                        !permissions.is("employee")
                      }
                      destructive
                      onClick={deleteModal.onOpen}
                    >
                      <DropdownMenuIcon icon={<LuTrash />} />
                      Delete Journal Entry
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <JournalEntryStatus status={status as any} />
            </HStack>
            <HStack>
              {isReversed && reversedById && (
                <Button variant="secondary" asChild>
                  <Link to={path.to.journalEntryDetails(reversedById)}>
                    Reversing Entry
                  </Link>
                </Button>
              )}
              {isDraft && permissions.can("update", "accounting") && (
                <>
                  <Button
                    type="submit"
                    name="intent"
                    value="save"
                    leftIcon={<LuSave />}
                    variant="secondary"
                  >
                    Save Draft
                  </Button>
                  <Button
                    type="submit"
                    name="intent"
                    value="post"
                    leftIcon={<LuCheckCheck />}
                    variant="primary"
                    isDisabled={!isBalanced || totalDebits === 0}
                  >
                    Post
                  </Button>
                </>
              )}
              {isPosted && permissions.can("create", "accounting") && (
                <Button
                  leftIcon={<LuRotateCcw />}
                  variant="destructive"
                  onClick={reverseModal.onOpen}
                  isLoading={reverseFetcher.state !== "idle"}
                >
                  Reverse
                </Button>
              )}
            </HStack>
          </CardHeader>

          <CardContent>
            <Hidden name="id" />
            <input type="hidden" name="lines" value={linesJson} />
            <VStack spacing={4} className="w-full">
              <CardTitle>Journal Entry</CardTitle>
              {/* Entry Details */}
              <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 w-full">
                <Input
                  name="company"
                  label="Company"
                  value={companyName}
                  isReadOnly
                />
                <Select
                  name="sourceType"
                  label="Source"
                  value={sourceType}
                  options={sourceTypeOptions}
                  isReadOnly
                />
                <DatePicker
                  name="postingDate"
                  label="Posting Date"
                  isDisabled={isDisabled}
                />

                <div className="col-span-3">
                  <Input name="description" label="Description" />
                </div>
              </div>

              <CardTitle>Lines</CardTitle>

              {/* Column Headers */}
              <div className="grid grid-cols-[auto_1fr_140px_140px_40px] items-center gap-3 px-4 text-xs font-medium text-muted-foreground -mb-4 w-full">
                <div className="w-6" />
                <div className="pl-3">Account & Details</div>
                <div className="text-right pr-3">Debit</div>
                <div className="text-right pr-3">Credit</div>
                <div />
              </div>

              {/* Journal Lines */}
              <div className="rounded-lg border border-border divide-y divide-border overflow-hidden w-full">
                {lines.map((line, index) => (
                  <JournalLineRow
                    key={line.id}
                    line={line}
                    index={index}
                    currencyCode={company.baseCurrencyCode}
                    onChange={(updatedLine) =>
                      handleLineChange(index, updatedLine)
                    }
                    onDelete={() => handleDeleteLine(index)}
                    canDelete={lines.length > 2}
                    isDisabled={isDisabled}
                  />
                ))}
              </div>

              {/* Add Line Button */}
              {!isDisabled && (
                <Button
                  variant="ghost"
                  onClick={handleAddLine}
                  leftIcon={<LuPlus />}
                  className="w-full border border-dashed border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                >
                  Add Line
                </Button>
              )}

              {/* Totals */}
              <div className="rounded-lg border bg-muted/50 p-4 w-full">
                <div className="grid grid-cols-[1fr_140px_140px_40px] items-center gap-3">
                  <div className="text-sm font-medium">Totals</div>
                  <div className="text-right font-mono text-sm tabular-nums">
                    {currencyFormatter.format(totalDebits)}
                  </div>
                  <div className="text-right font-mono text-sm tabular-nums">
                    {currencyFormatter.format(totalCredits)}
                  </div>
                  <div />
                </div>

                {/* Balance Indicator */}
                <div className="mt-4 flex items-center justify-between border-t pt-4">
                  <div className="flex items-center gap-2">
                    {isBalanced && totalDebits > 0 ? (
                      <>
                        <LuCircleCheck className="size-5 text-green-600 dark:text-green-400" />
                        <span className="text-sm font-medium text-green-600 dark:text-green-400">
                          Entry is balanced
                        </span>
                      </>
                    ) : totalDebits === 0 && totalCredits === 0 ? (
                      <>
                        <LuCircleAlert className="size-5 text-yellow-600 dark:text-yellow-400" />
                        <span className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
                          Enter at least one debit and credit
                        </span>
                      </>
                    ) : (
                      <>
                        <LuCircleAlert className="size-5 text-yellow-600 dark:text-yellow-400" />
                        <span className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
                          Entry is not balanced
                        </span>
                      </>
                    )}
                  </div>
                  {!isBalanced && totalDebits > 0 && (
                    <div className="text-sm text-muted-foreground">
                      Difference:{" "}
                      <span className="font-mono tabular-nums">
                        {currencyFormatter.format(Math.abs(difference))}
                      </span>{" "}
                      {difference > 0 ? "more in debits" : "more in credits"}
                    </div>
                  )}
                </div>
              </div>
            </VStack>
          </CardContent>
        </ValidatedForm>
      </Card>

      <ConfirmDelete
        isOpen={deleteModal.isOpen}
        name={displayId}
        text="Are you sure you want to delete this journal entry?"
        onCancel={deleteModal.onClose}
        onSubmit={() => {
          deleteModal.onClose();
          navigate(path.to.deleteJournalEntry(journalEntryId));
        }}
      />
      <ConfirmDelete
        isOpen={reverseModal.isOpen}
        name={displayId}
        deleteText="Reverse Entry"
        text="Are you sure you want to reverse this journal entry? This will create a new posted entry with negated amounts and mark this entry as Reversed."
        onCancel={reverseModal.onClose}
        onSubmit={() => {
          reverseModal.onClose();
          reverseFetcher.submit(null, {
            method: "post",
            action: path.to.reverseJournalEntry(journalEntryId)
          });
        }}
      />
    </>
  );
};

export default JournalEntryForm;
