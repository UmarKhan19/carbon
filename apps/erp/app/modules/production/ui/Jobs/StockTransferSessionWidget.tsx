import type { Result } from "@carbon/auth";
import {
  Badge,
  Button,
  Count,
  HStack,
  IconButton,
  ScrollArea
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import {
  LuCheckCheck,
  LuMaximize2,
  LuMinus,
  LuShoppingCart,
  LuTrash2,
  LuTruck,
  LuX
} from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  useOrderItems,
  useStockTransferSession,
  useStockTransferSessionItemsCount,
  useTransferItems
} from "~/stores/stock-transfer";
import { path } from "~/utils/path";

// Floating "Action Items" panel for ordering/transferring a job's short parts.
export const StockTransferSessionWidget = ({ jobId }: { jobId: string }) => {
  const fetcher = useFetcher<Result>();
  const { t } = useLingui();

  const [session, setStockTransferSession] = useStockTransferSession();
  const sessionItemsCount = useStockTransferSessionItemsCount();
  const orderItems = useOrderItems();
  const transferItems = useTransferItems();

  const [isExpanded, setIsExpanded] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const allItems = [...orderItems, ...transferItems];

  const onRemoveItem = (itemId: string, action: "order" | "transfer") => {
    const updatedItems = session.items.filter(
      (sessionItem) =>
        !(sessionItem.id === itemId && sessionItem.action === action)
    );
    setStockTransferSession({ items: updatedItems });
  };

  const onClearAll = () => {
    setStockTransferSession({ items: [] });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (fetcher.data?.success) {
      onClearAll();
    }
  }, [fetcher.data?.success]);

  if (sessionItemsCount === 0) {
    return null;
  }

  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={() => setIsMinimized(false)}
          className="relative flex items-center justify-center w-16 h-16 bg-card border-2 border-border rounded-full shadow-2xl hover:scale-105 transition-transform duration-200"
        >
          <LuShoppingCart className="w-6 h-6 text-foreground" />
          {allItems.length > 0 && (
            <Badge className="absolute -top-2 -right-2 h-7 w-7 flex items-center justify-center p-0 border-2 border-background">
              {allItems.length}
            </Badge>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-[9999]">
      <div
        className={`bg-card border-2 border-border rounded-2xl shadow-2xl transition-all duration-300 ease-in-out ${
          isExpanded ? "w-96 h-[32rem]" : "w-80 h-auto"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b-2 border-border">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 bg-primary rounded-lg">
              <LuCheckCheck className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h3 className="font-semibold text-card-foreground text-base">
                <Trans>Action Items</Trans>
              </h3>
              <p className="text-xs text-muted-foreground">
                {allItems.length} {allItems.length === 1 ? t`item` : t`items`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={isExpanded ? t`Minimize` : t`Expand`}
              icon={
                isExpanded ? (
                  <LuMinus className="size-4" />
                ) : (
                  <LuMaximize2 className="size-4" />
                )
              }
              onClick={() => setIsExpanded(!isExpanded)}
            />
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={t`Close`}
              icon={<LuX className="size-4" />}
              onClick={() => setIsMinimized(true)}
            />
          </div>
        </div>

        {/* Content */}
        {isExpanded ? (
          <div className="flex flex-col h-[calc(32rem-5rem)]">
            <ScrollArea className="flex-1 p-4">
              {allItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                    <LuShoppingCart className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <Trans>No parts added yet</Trans>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    <Trans>Start adding parts to your stock transfer</Trans>
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {orderItems.length > 0 && (
                    <div className="mb-4">
                      <HStack className="mb-2">
                        <LuShoppingCart className="h-3 w-3" />
                        <span className="text-sm font-medium">
                          <Trans>Orders</Trans>{" "}
                          <Count count={orderItems.length} />
                        </span>
                      </HStack>
                      <div className="space-y-2">
                        {orderItems.map((item) => (
                          <div
                            key={`${item.id}-order`}
                            className="group bg-secondary/50 border border-border rounded-lg p-3 hover:bg-secondary transition-colors"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="font-mono text-xs font-semibold">
                                    {item.itemReadableId}
                                  </span>
                                  <Badge variant="outline">
                                    <Trans>Order</Trans>
                                  </Badge>
                                </div>
                                <p className="text-sm text-card-foreground font-medium truncate">
                                  {item.description}
                                </p>
                              </div>
                              <IconButton
                                variant="secondary"
                                aria-label={t`Remove item`}
                                icon={<LuTrash2 />}
                                size="sm"
                                onClick={() => onRemoveItem(item.id, "order")}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {transferItems.length > 0 && (
                    <div>
                      <HStack className="mb-2">
                        <LuTruck className="h-3 w-3" />
                        <span className="text-sm font-medium">
                          <Trans>Transfers</Trans>{" "}
                          <Count count={transferItems.length} />
                        </span>
                      </HStack>
                      <div className="space-y-2">
                        {transferItems.map((item) => (
                          <div
                            key={`${item.id}-transfer`}
                            className="group bg-secondary/50 border border-border rounded-lg p-3 hover:bg-secondary transition-colors"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="font-mono text-xs font-semibold">
                                    {item.itemReadableId}
                                  </span>
                                  <Badge variant="outline">
                                    <Trans>Transfer</Trans>
                                  </Badge>
                                </div>
                                <p className="text-sm text-card-foreground font-medium truncate">
                                  {item.description}
                                </p>
                              </div>
                              <IconButton
                                variant="secondary"
                                aria-label={t`Remove item`}
                                icon={<LuTrash2 />}
                                size="sm"
                                onClick={() =>
                                  onRemoveItem(item.id, "transfer")
                                }
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>

            {/* Footer */}
            {allItems.length > 0 && (
              <div className="p-4 border-t-2 border-border space-y-2 w-full">
                <fetcher.Form
                  method="post"
                  action={path.to.newJobMaterialsSession(jobId)}
                >
                  <input type="hidden" name="jobId" value={jobId} />
                  <input
                    type="hidden"
                    name="items"
                    value={JSON.stringify(allItems)}
                  />
                  <Button
                    isLoading={fetcher.state !== "idle"}
                    isDisabled={fetcher.state !== "idle"}
                    size="lg"
                    className="w-full"
                    type="submit"
                  >
                    <Trans>Create</Trans>
                  </Button>
                </fetcher.Form>
                <Button variant="ghost" className="w-full" onClick={onClearAll}>
                  <Trans>Clear All</Trans>
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {allItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-2">
                <Trans>No parts added yet</Trans>
              </p>
            ) : (
              <div className="space-y-2">
                {allItems.slice(0, 3).map((item) => (
                  <div
                    key={`${item.id}-${item.action}`}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="font-mono text-xs">
                      {item.itemReadableId}
                    </span>
                    <Badge variant="outline">{item.action}</Badge>
                  </div>
                ))}
                {allItems.length > 3 && (
                  <p className="text-xs text-muted-foreground text-center pt-1">
                    <Trans>+{allItems.length - 3} more</Trans>
                  </p>
                )}
              </div>
            )}
            {allItems.length > 0 && (
              <fetcher.Form
                method="post"
                action={path.to.newJobMaterialsSession(jobId)}
              >
                <input type="hidden" name="jobId" value={jobId} />
                <input
                  type="hidden"
                  name="items"
                  value={JSON.stringify(allItems)}
                />
                <Button
                  isLoading={fetcher.state !== "idle"}
                  isDisabled={fetcher.state !== "idle"}
                  size="lg"
                  className="w-full"
                  type="submit"
                >
                  Create
                </Button>
              </fetcher.Form>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
