import {
  Button,
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
  useDisclosure
} from "@carbon/react";
import {
  LuCheckCheck,
  LuEllipsisVertical,
  LuRotateCcw,
  LuTrash
} from "react-icons/lu";
import { Link, useFetcher, useNavigate, useParams } from "react-router";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { JournalEntry } from "../../types";
import JournalEntryStatus from "./JournalEntryStatus";

const JournalEntryHeader = () => {
  const { journalEntryId } = useParams();
  if (!journalEntryId) throw new Error("journalEntryId not found");

  const routeData = useRouteData<{
    journalEntry: JournalEntry;
  }>(path.to.journalEntry(journalEntryId));

  if (!routeData?.journalEntry) throw new Error("Failed to load journal entry");

  const permissions = usePermissions();
  const deleteModal = useDisclosure();
  const navigate = useNavigate();
  const postFetcher = useFetcher();
  const reverseFetcher = useFetcher();

  const isDraft = routeData.journalEntry.status === "Draft";
  const isPosted = routeData.journalEntry.status === "Posted";
  const lines = routeData.journalEntry.journalLine ?? [];
  const total = lines.reduce((sum, l) => sum + Number(l.amount), 0);
  const isBalanced = lines.length > 0 && Math.abs(total) < 0.001;

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1)]">
        <HStack className="w-full justify-between">
          <HStack>
            <Link to={path.to.journalEntryDetails(journalEntryId)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span>{routeData.journalEntry.journalEntryId}</span>
              </Heading>
            </Link>
            <Copy text={routeData.journalEntry.journalEntryId ?? ""} />
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
                {isDraft && (
                  <>
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
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <JournalEntryStatus status={routeData.journalEntry.status} />
          </HStack>
          <HStack>
            {isDraft && permissions.can("update", "accounting") && (
              <postFetcher.Form
                method="post"
                action={path.to.postJournalEntry(journalEntryId)}
              >
                <Button
                  type="submit"
                  leftIcon={<LuCheckCheck />}
                  variant="primary"
                  isDisabled={!isBalanced}
                  isLoading={postFetcher.state !== "idle"}
                >
                  Post
                </Button>
              </postFetcher.Form>
            )}
            {isPosted && permissions.can("create", "accounting") && (
              <reverseFetcher.Form
                method="post"
                action={path.to.reverseJournalEntry(journalEntryId)}
              >
                <Button
                  type="submit"
                  leftIcon={<LuRotateCcw />}
                  variant="secondary"
                  isLoading={reverseFetcher.state !== "idle"}
                >
                  Reverse
                </Button>
              </reverseFetcher.Form>
            )}
          </HStack>
        </HStack>
      </div>
      <ConfirmDelete
        isOpen={deleteModal.isOpen}
        name={routeData.journalEntry.journalEntryId}
        text="Are you sure you want to delete this journal entry?"
        onCancel={deleteModal.onClose}
        onSubmit={() => {
          deleteModal.onClose();
          navigate(path.to.deleteJournalEntry(journalEntryId));
        }}
      />
    </>
  );
};

export default JournalEntryHeader;
