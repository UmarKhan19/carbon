import { useCarbon } from "@carbon/auth";
import { Select, Submit, ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
  useMount,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import {
  LuCircleCheck,
  LuCircleX,
  LuEllipsisVertical,
  LuLoaderCircle,
  LuPanelLeft,
  LuPanelRight,
  LuTrash,
  LuTriangleAlert
} from "react-icons/lu";
import { RiProgress4Line } from "react-icons/ri";
import type { FetcherWithComponents } from "react-router";
import { Link, useFetcher, useParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { usePanels } from "~/components/Layout";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import { isSalesRfqLocked } from "../../sales.models";
import type { Opportunity, SalesRFQ, SalesRFQLine } from "../../types";
import SalesRFQStatus from "./SalesRFQStatus";

const SalesRFQHeader = () => {
  const { t } = useLingui();
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("rfqId not found");

  const convertToQuoteModal = useDisclosure();
  const requiresCustomerAlert = useDisclosure();
  const noQuoteReasonModal = useDisclosure();
  const deleteRFQModal = useDisclosure();
  const { toggleExplorer, toggleProperties } = usePanels();

  const permissions = usePermissions();

  const routeData = useRouteData<{
    rfqSummary: SalesRFQ;
    lines: SalesRFQLine[];
    opportunity: Opportunity;
  }>(path.to.salesRfq(rfqId));

  const status = routeData?.rfqSummary?.status ?? "Draft";
  const isLocked = isSalesRfqLocked(status);

  const statusFetcher = useFetcher<{}>();

  return (
    <div className="flex flex-shrink-0 items-center justify-between p-2 bg-card border-b h-[50px] overflow-x-auto scrollbar-hide ">
      <HStack className="w-full justify-between">
        <HStack>
          <IconButton
            aria-label={t({
              id: "Toggle Explorer",
              message: "Toggle Explorer"
            })}
            icon={<LuPanelLeft />}
            onClick={toggleExplorer}
            variant="ghost"
          />
          <Link to={path.to.salesRfqDetails(rfqId)}>
            <Heading size="h4" className="flex items-center gap-2">
              <span>{routeData?.rfqSummary?.rfqId}</span>
            </Heading>
          </Link>
          <Copy text={routeData?.rfqSummary?.rfqId ?? ""} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={t({
                  id: "More options",
                  message: "More options"
                })}
                icon={<LuEllipsisVertical />}
                variant="secondary"
                size="sm"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                disabled={
                  isLocked ||
                  !permissions.can("delete", "sales") ||
                  !permissions.is("employee")
                }
                destructive
                onClick={deleteRFQModal.onOpen}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                {t({ id: "Delete RFQ", message: "Delete RFQ" })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <SalesRFQStatus status={routeData?.rfqSummary?.status} />
        </HStack>
        <HStack>
          {routeData?.rfqSummary?.customerId ? (
            <statusFetcher.Form
              method="post"
              action={path.to.salesRfqStatus(rfqId)}
            >
              <input type="hidden" name="status" value="Ready for Quote" />
              <Button
                isDisabled={
                  status !== "Draft" ||
                  routeData?.lines?.length === 0 ||
                  !permissions.can("update", "sales")
                }
                isLoading={
                  statusFetcher.state !== "idle" &&
                  statusFetcher.formData?.get("status") === "Ready for Quote"
                }
                leftIcon={<LuCircleCheck />}
                variant={status === "Draft" ? "primary" : "secondary"}
                type="submit"
              >
                {t({
                  id: "Ready for Quote",
                  message: "Ready for Quote"
                })}
              </Button>
            </statusFetcher.Form>
          ) : (
            <Button
              isDisabled={
                status !== "Ready for Quote" ||
                routeData?.lines?.length === 0 ||
                !permissions.can("update", "sales")
              }
              leftIcon={<LuCircleCheck />}
              variant={status === "Draft" ? "primary" : "secondary"}
              onClick={requiresCustomerAlert.onOpen}
            >
              {t({
                id: "Ready for Quote",
                message: "Ready for Quote"
              })}
            </Button>
          )}

          <Button
            isDisabled={
              status !== "Ready for Quote" ||
              routeData?.lines?.length === 0 ||
              !permissions.can("create", "sales")
            }
            leftIcon={<RiProgress4Line />}
            type="submit"
            variant={
              ["Ready for Quote", "Quoted"].includes(status)
                ? "primary"
                : "secondary"
            }
            onClick={convertToQuoteModal.onOpen}
          >
            {t({ id: "Quote", message: "Quote" })}
          </Button>
          {/* <statusFetcher.Form
            method="post"
            action={path.to.salesRfqStatus(rfqId)}
          >
            <input type="hidden" name="status" value="Closed" />
            <Button
              isDisabled={
                status !== "Ready for Quote" ||
                statusFetcher.state !== "idle" ||
                !permissions.can("update", "sales")
              }
              isLoading={
                statusFetcher.state !== "idle" &&
                statusFetcher.formData?.get("status") === "Closed"
              }
              leftIcon={<LuCircleX />}
              type="submit"
              variant={
                ["Ready for Quote", "Closed"].includes(status)
                  ? "destructive"
                  : "secondary"
              }
            >
              No Quote
            </Button>
          </statusFetcher.Form> */}
          <Button
            onClick={noQuoteReasonModal.onOpen}
            isDisabled={
              status !== "Ready for Quote" ||
              statusFetcher.state !== "idle" ||
              !permissions.can("update", "sales")
            }
            isLoading={
              statusFetcher.state !== "idle" &&
              statusFetcher.formData?.get("status") === "Closed"
            }
            leftIcon={<LuCircleX />}
            variant={
              ["Ready for Quote", "Closed"].includes(status)
                ? "destructive"
                : "secondary"
            }
          >
            {t({ id: "No Quote", message: "No Quote" })}
          </Button>

          <statusFetcher.Form
            method="post"
            action={path.to.salesRfqStatus(rfqId)}
          >
            <input type="hidden" name="status" value="Draft" />
            {routeData?.opportunity?.quotes.length === 0 ? (
              <Button
                isDisabled={
                  !["Ready for Quote", "Closed", "Quoted"].includes(status) ||
                  statusFetcher.state !== "idle" ||
                  !permissions.can("update", "sales")
                }
                isLoading={
                  statusFetcher.state !== "idle" &&
                  statusFetcher.formData?.get("status") === "Draft"
                }
                leftIcon={<LuLoaderCircle />}
                type="submit"
                variant="secondary"
              >
                {t({ id: "Reopen", message: "Reopen" })}
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    leftIcon={<LuLoaderCircle />}
                    isDisabled
                    variant="secondary"
                  >
                    {t({ id: "Reopen", message: "Reopen" })}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t({
                    id: "RFQ is linked to a Quote. Delete the quote to reopen.",
                    message:
                      "RFQ is linked to a Quote. Delete the quote to reopen."
                  })}
                </TooltipContent>
              </Tooltip>
            )}
          </statusFetcher.Form>

          <IconButton
            aria-label={t({
              id: "Toggle Properties",
              message: "Toggle Properties"
            })}
            icon={<LuPanelRight />}
            onClick={toggleProperties}
            variant="ghost"
          />
        </HStack>
      </HStack>
      {convertToQuoteModal.isOpen && (
        <ConvertToQuoteModal
          lines={routeData?.lines ?? []}
          rfqId={rfqId}
          onClose={convertToQuoteModal.onClose}
        />
      )}
      {requiresCustomerAlert.isOpen && (
        <RequiresCustomerAlert onClose={requiresCustomerAlert.onClose} />
      )}
      {noQuoteReasonModal.isOpen && (
        <NoQuoteReasonModal
          fetcher={statusFetcher}
          rfqId={rfqId}
          onClose={noQuoteReasonModal.onClose}
        />
      )}
      {deleteRFQModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteSalesRfq(rfqId)}
          isOpen={deleteRFQModal.isOpen}
          name={routeData?.rfqSummary?.rfqId!}
          text={t({
            id: "Are you sure you want to delete {{rfqId}}? This cannot be undone.",
            message: `Are you sure you want to delete ${routeData?.rfqSummary
              ?.rfqId!}? This cannot be undone.`
          })}
          onCancel={() => {
            deleteRFQModal.onClose();
          }}
          onSubmit={() => {
            deleteRFQModal.onClose();
          }}
        />
      )}
    </div>
  );
};

export default SalesRFQHeader;

const rfqNoQuoteReasonValidator = z.object({
  status: z.enum(["Closed"]),
  noQuoteReasonId: zfd.text(z.string().optional())
});

function NoQuoteReasonModal({
  fetcher,
  rfqId,
  onClose
}: {
  fetcher: FetcherWithComponents<{}>;
  rfqId: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const user = useUser();
  const [noQuoteReasons, setNoQuoteReasons] = useState<
    {
      label: string;
      value: string;
    }[]
  >([]);
  const { carbon } = useCarbon();
  const fetchReasons = async () => {
    if (!carbon) return;
    const { data } = await carbon
      .from("noQuoteReason")
      .select("*")
      .eq("companyId", user.company.id);

    setNoQuoteReasons(
      data?.map((reason) => ({ label: reason.name, value: reason.id })) ?? []
    );
  };

  useMount(() => {
    fetchReasons();
  });

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.salesRfqStatus(rfqId)}
          validator={rfqNoQuoteReasonValidator}
          fetcher={fetcher}
          onSubmit={() => {
            onClose();
          }}
        >
          <ModalHeader>
            <ModalTitle>
              {t({ id: "No Quote Reason", message: "No Quote Reason" })}
            </ModalTitle>
            <ModalDescription>
              {t({
                id: "Select a reason for why the quote was not created.",
                message: "Select a reason for why the quote was not created."
              })}
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <input type="hidden" name="status" value="Closed" />
            <VStack spacing={2}>
              <Select
                name="noQuoteReasonId"
                label={t({
                  id: "No Quote Reason",
                  message: "No Quote Reason"
                })}
                options={noQuoteReasons}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              {t({ id: "Cancel", message: "Cancel" })}
            </Button>
            <Submit withBlocker={false}>
              {t({ id: "Save", message: "Save" })}
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

function RequiresCustomerAlert({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            {t({
              id: "Cannot convert RFQ to quote",
              message: "Cannot convert RFQ to quote"
            })}
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <Alert variant="destructive">
            <LuTriangleAlert className="h-4 w-4" />
            <AlertTitle>
              {t({ id: "RFQ has no customer", message: "RFQ has no customer" })}
            </AlertTitle>
            <AlertDescription>
              {t({
                id: "In order to convert this RFQ to a quote, it must be associated with a customer.",
                message:
                  "In order to convert this RFQ to a quote, it must be associated with a customer."
              })}
            </AlertDescription>
          </Alert>
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose}>{t({ id: "OK", message: "OK" })}</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ConvertToQuoteModal({
  lines,
  rfqId,
  onClose
}: {
  lines: SalesRFQLine[];
  rfqId: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const routeData = useRouteData<{ rfqSummary: SalesRFQ }>(
    path.to.salesRfq(rfqId)
  );

  const fetcher = useFetcher<{ error: string | null }>();
  const isLoading = fetcher.state !== "idle";
  const linesWithoutItems = lines.filter((line) => !line.itemId);
  const requiresPartNumbers = linesWithoutItems.length > 0;
  const requiresCustomer = !routeData?.rfqSummary?.customerId;

  useEffect(() => {
    if (fetcher.state === "loading") {
      onClose();
    }
  }, [fetcher.state, onClose]);

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            {t({ id: "Convert to Quote", message: "Convert to Quote" })}
          </ModalTitle>
          <ModalDescription>
            {t({
              id: "Are you sure you want to convert the RFQ to a quote?",
              message: "Are you sure you want to convert the RFQ to a quote?"
            })}
          </ModalDescription>
        </ModalHeader>

        <ModalBody>
          {requiresCustomer && (
            <Alert variant="destructive">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                {t({
                  id: "RFQ has no customer",
                  message: "RFQ has no customer"
                })}
              </AlertTitle>
              <AlertDescription>
                {t({
                  id: "In order to convert this RFQ to a quote, it must have a customer.",
                  message:
                    "In order to convert this RFQ to a quote, it must have a customer."
                })}
              </AlertDescription>
            </Alert>
          )}
          {requiresPartNumbers && (
            <Alert variant="warning">
              <LuTriangleAlert className="h-4 w-4" />
              <AlertTitle>
                {t({
                  id: "Lines need internal part numbers",
                  message: "Lines need internal part numbers"
                })}
              </AlertTitle>
              <AlertDescription>
                {t({
                  id: "In order to convert this RFQ to a quote, all lines must have an internal part number.",
                  message:
                    "In order to convert this RFQ to a quote, all lines must have an internal part number."
                })}{" "}
                <br />
                <br />
                {t({
                  id: "Upon clicking Convert, parts will be created with the following internal part numbers:",
                  message:
                    "Upon clicking Convert, parts will be created with the following internal part numbers:"
                })}
                <ul className="list-disc py-2 pl-4">
                  {linesWithoutItems.map((line) => (
                    <li key={line.id}>
                      {line.customerPartId}
                      {line.customerPartRevision &&
                        `.${line.customerPartRevision}`}
                    </li>
                  ))}
                </ul>
                <br />
                {t({
                  id: "If you wish to change the part numbers, please click Cancel and manually assign the parts for each line item before converting.",
                  message:
                    "If you wish to change the part numbers, please click Cancel and manually assign the parts for each line item before converting."
                })}
              </AlertDescription>
            </Alert>
          )}
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            {t({ id: "Cancel", message: "Cancel" })}
          </Button>
          <fetcher.Form method="post" action={path.to.salesRfqConvert(rfqId)}>
            <Button isDisabled={isLoading} type="submit" isLoading={isLoading}>
              {t({ id: "Convert", message: "Convert" })}
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
