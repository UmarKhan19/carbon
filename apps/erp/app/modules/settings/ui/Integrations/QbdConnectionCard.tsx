import {
  Alert,
  AlertTitle,
  Button,
  DrawerBody,
  HStack,
  IconButton,
  Input as InputBase,
  InputGroup,
  InputRightElement,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  LuCheck,
  LuClipboard,
  LuDownload,
  LuKeyRound,
  LuLock,
  LuRotateCw,
  LuTriangleAlert
} from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import { useDateFormatter, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { copyToClipboard } from "~/utils/string";

/**
 * Local structural mirror of the integrations.$id loader's qbdConnection
 * fragment. Deliberately not imported from the route or @carbon/ee (even
 * type-only) per the TS2589 doctrine documented in SyncActivity.tsx and
 * ./index.ts — this component is also NOT barrel-exported for the same
 * reason. The route's loader passes the real shape, so drift fails
 * typecheck at that call site.
 */
export type QbdConnection = {
  /** A webConnector credential set exists on the integration metadata. */
  hasCredentials: boolean;
  /** QBWC login name (`carbon-<companyId>`); null until generated. */
  username: string | null;
  /** Most recent Web Connector poll (qbwcSession lastSeenAt), if any. */
  lastPollAt: string | null;
  /** No poll ever, or the last poll is older than 24 hours. */
  stale: boolean;
};

/**
 * Connection tab for the QuickBooks Desktop integration: poll health, the
 * setup checklist from the spec, Web Connector credential issuance with
 * the shown-once password (ApiKeys pattern), and the .qwc file download.
 *
 * The download is a plain anchor to a GET resource route
 * (path.to.integrationQwcFile) rather than an action intent — attachment
 * responses only work on document requests (see the note in
 * integrations.$id.qwc.tsx).
 */
export function QbdConnectionCard({
  connection
}: {
  connection: QbdConnection;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "settings");
  const { formatRelativeTime } = useDateFormatter();

  const fetcher = useFetcher<{ qbdPassword?: string }>();
  const isSubmitting = fetcher.state !== "idle";

  // One-time password display: the action returns the plaintext exactly
  // once (only the scrypt hash is persisted). Kept in state so it stays
  // visible until the drawer closes — mirroring the ApiKeys shown-once UX.
  const [password, setPassword] = useState<string | null>(null);
  const [showRotateConfirm, setShowRotateConfirm] = useState(false);

  useEffect(() => {
    if (fetcher.data?.qbdPassword) {
      setPassword(fetcher.data.qbdPassword);
    }
  }, [fetcher.data]);

  const submitGenerate = () => {
    const formData = new FormData();
    formData.append("intent", "qbd-generate-credentials");
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <>
      <DrawerBody className="gap-6">
        {/* Poll health */}
        <VStack spacing={2} className="w-full">
          {connection.stale && (
            <div className="flex w-full items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
              <LuTriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-500" />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {connection.lastPollAt ? (
                    <Trans>
                      The Web Connector has not polled in the last 24 hours
                    </Trans>
                  ) : (
                    <Trans>The Web Connector has never connected</Trans>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {connection.lastPollAt ? (
                    <Trans>
                      Check that the QuickBooks machine is on and the QuickBooks
                      Web Connector is running with the Carbon application
                      enabled.
                    </Trans>
                  ) : (
                    <Trans>
                      Pending operations wait for the Web Connector poll.
                      Generate credentials and install the .qwc file below to
                      start syncing.
                    </Trans>
                  )}
                </span>
              </div>
            </div>
          )}
          <div className="flex w-full items-center justify-between text-sm">
            <span className="text-muted-foreground">
              <Trans>Last poll</Trans>
            </span>
            <span className="font-medium">
              {connection.lastPollAt ? (
                formatRelativeTime(connection.lastPollAt)
              ) : (
                <Trans>Never</Trans>
              )}
            </span>
          </div>
        </VStack>

        {/* Setup checklist */}
        <div className="flex w-full flex-col gap-3 border-t border-border pt-4">
          <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-foreground/70">
            <Trans>Setup checklist</Trans>
          </div>
          <ol className="flex w-full flex-col gap-3">
            <ChecklistItem step={1}>
              <Trans>
                Open your company file in QuickBooks as Admin in single-user
                mode. When the Web Connector first connects, approve the Carbon
                application certificate — choose "Yes, always; allow access even
                if QuickBooks is not running" so sync runs unattended.
              </Trans>
            </ChecklistItem>
            <ChecklistItem step={2}>
              <Trans>
                Turn QuickBooks inventory features off. Carbon owns inventory
                and posts its value as journal entries; items sync as
                non-inventory items.
              </Trans>
            </ChecklistItem>
            <ChecklistItem step={3}>
              <Trans>
                Complete the account mapping so posted journal lines resolve to
                accounts in your QuickBooks chart of accounts.
              </Trans>{" "}
              <Link
                to="?tab=account-mapping"
                className="underline decoration-dotted underline-offset-2 hover:text-foreground"
              >
                <Trans>Open Account Mapping</Trans>
              </Link>
            </ChecklistItem>
            <ChecklistItem step={4}>
              <Trans>
                Pick a conversion date with your bookkeeper. Only documents and
                journals dated after the cutover should sync — earlier history
                stays in QuickBooks.
              </Trans>
            </ChecklistItem>
          </ol>
        </div>

        {/* Credentials + .qwc download */}
        <div className="flex w-full flex-col gap-3 border-t border-border pt-4">
          <div className="text-[0.6875rem] font-semibold uppercase tracking-wider text-foreground/70">
            <Trans>Web Connector connection</Trans>
          </div>

          {connection.hasCredentials && connection.username && (
            <div className="flex w-full items-center justify-between gap-4 text-sm">
              <span className="text-muted-foreground">
                <Trans>Username</Trans>
              </span>
              <span className="truncate font-mono text-xs">
                {connection.username}
              </span>
            </div>
          )}

          {password && (
            <VStack spacing={2} className="w-full">
              <Alert variant="info">
                <LuLock className="h-4 w-4" />
                <AlertTitle>
                  <Trans>
                    You can only see this password once. Enter it in the
                    QuickBooks Web Connector.
                  </Trans>
                </AlertTitle>
              </Alert>
              <div className="flex w-full flex-col gap-2">
                <Label htmlFor="qbwc-password">
                  <Trans>Web Connector password</Trans>
                </Label>
                <InputGroup>
                  <InputBase id="qbwc-password" value={password} readOnly />
                  <InputRightElement className="w-[2.75rem]">
                    <CopyButton value={password} label={t`Copy password`} />
                  </InputRightElement>
                </InputGroup>
              </div>
            </VStack>
          )}

          <HStack className="w-full flex-wrap gap-2">
            {connection.hasCredentials ? (
              <>
                <Button
                  variant="secondary"
                  leftIcon={<LuRotateCw />}
                  isDisabled={!canUpdate || isSubmitting}
                  isLoading={isSubmitting}
                  onClick={() => setShowRotateConfirm(true)}
                >
                  <Trans>Rotate password</Trans>
                </Button>
                <Button leftIcon={<LuDownload />} asChild>
                  <a
                    href={path.to.integrationQwcFile("quickbooks-desktop")}
                    download
                  >
                    <Trans>Download .qwc file</Trans>
                  </a>
                </Button>
              </>
            ) : (
              <Button
                leftIcon={<LuKeyRound />}
                isDisabled={!canUpdate || isSubmitting}
                isLoading={isSubmitting}
                onClick={submitGenerate}
              >
                <Trans>Generate credentials</Trans>
              </Button>
            )}
          </HStack>

          <p className="text-xs leading-relaxed text-muted-foreground">
            {connection.hasCredentials ? (
              <Trans>
                In QuickBooks Web Connector, choose Add an Application and
                select the downloaded carbon-quickbooks.qwc file, then enter the
                password when prompted. The connector polls Carbon every 5
                minutes.
              </Trans>
            ) : (
              <Trans>
                Carbon issues a username and one-time password for the
                QuickBooks Web Connector. After generating, download the .qwc
                file and install it in the Web Connector on the QuickBooks
                machine.
              </Trans>
            )}
          </p>
        </div>
      </DrawerBody>

      {showRotateConfirm && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setShowRotateConfirm(false);
          }}
        >
          <ModalContent>
            <ModalHeader>
              <ModalTitle>
                <Trans>Rotate Web Connector password</Trans>
              </ModalTitle>
            </ModalHeader>
            <ModalBody>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  The current password stops working immediately and syncing
                  pauses until you enter the new password in the QuickBooks Web
                  Connector on the QuickBooks machine. The installed .qwc file
                  stays valid — do not re-add it.
                </Trans>
              </p>
            </ModalBody>
            <ModalFooter>
              <HStack>
                <Button
                  variant="destructive"
                  isDisabled={!canUpdate || isSubmitting}
                  onClick={() => {
                    submitGenerate();
                    setShowRotateConfirm(false);
                  }}
                >
                  <Trans>Rotate password</Trans>
                </Button>
                <Button
                  variant="solid"
                  onClick={() => setShowRotateConfirm(false)}
                >
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </>
  );
}

function ChecklistItem({
  step,
  children
}: {
  step: number;
  children: ReactNode;
}) {
  return (
    <li className="flex w-full items-start gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[0.6875rem] font-semibold tabular-nums">
        {step}
      </span>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {children}
      </p>
    </li>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <IconButton
      aria-label={label}
      icon={copied ? <LuCheck /> : <LuClipboard />}
      variant="ghost"
      onClick={() => {
        copyToClipboard(value, () => {
          setCopied(true);
        });
      }}
    />
  );
}
