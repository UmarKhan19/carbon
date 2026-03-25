"use client";

import {
  Avatar,
  Button,
  HStack,
  Input,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  VStack
} from "@carbon/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuCheck,
  LuCopy,
  LuLoader,
  LuLogOut,
  LuPlus,
  LuRefreshCw,
  LuSearch,
  LuX
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { usePeople } from "~/stores";
import { path } from "~/utils/path";

const RECENT_KEY_PREFIX = "console-recent-";
const MAX_RECENT = 5;

function generatePin(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function getRecentOperators(companyId: string): string[] {
  try {
    const raw = localStorage.getItem(`${RECENT_KEY_PREFIX}${companyId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function addRecentOperator(companyId: string, userId: string) {
  try {
    const recent = getRecentOperators(companyId).filter((id) => id !== userId);
    recent.unshift(userId);
    localStorage.setItem(
      `${RECENT_KEY_PREFIX}${companyId}`,
      JSON.stringify(recent.slice(0, MAX_RECENT))
    );
  } catch {
    // localStorage not available
  }
}

type Person = { id: string; name: string; avatarUrl: string | null };

export function PinInOverlay({
  companyId,
  locationEmployeeIds,
  sessionUserId,
  hasPinnedUser = false,
  dismissable = false,
  onDismiss
}: {
  companyId: string;
  locationEmployeeIds: string[];
  sessionUserId?: string;
  hasPinnedUser?: boolean;
  dismissable?: boolean;
  onDismiss?: () => void;
}) {
  const [people] = usePeople();
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [generatedPin, setGeneratedPin] = useState(generatePin);
  const searchRef = useRef<HTMLInputElement>(null);

  const pinInFetcher = useFetcher<{ error?: string }>();
  const pinOutFetcher = useFetcher();
  const addOperatorFetcher = useFetcher<{
    success: boolean;
    message?: string;
    operator?: Person & { pin: string };
  }>();

  const recentIds = useMemo(() => getRecentOperators(companyId), [companyId]);
  const isAdding = addOperatorFetcher.state !== "idle";
  const isPinning = pinInFetcher.state !== "idle";

  // Escape key to close when dismissable (but not when add modal is open)
  useEffect(() => {
    if (!dismissable) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !showAddModal) onDismiss?.();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dismissable, onDismiss, showAddModal]);

  const submitPinIn = useCallback(
    (person: Person, pinValue: string) => {
      addRecentOperator(companyId, person.id);
      const formData = new FormData();
      formData.append("userId", person.id);
      formData.append("name", person.name);
      formData.append("avatarUrl", person.avatarUrl ?? "");
      if (pinValue) formData.append("pin", pinValue);
      pinInFetcher.submit(formData, {
        method: "POST",
        action: path.to.consolePinIn
      });
    },
    [companyId, pinInFetcher]
  );

  // Handle pin-in errors
  useEffect(() => {
    if (pinInFetcher.state === "idle" && pinInFetcher.data?.error) {
      setPinError(pinInFetcher.data.error);
      setPin("");
    }
  }, [pinInFetcher.state, pinInFetcher.data]);

  // Auto-pin after successful quick-add
  useEffect(() => {
    if (
      addOperatorFetcher.state === "idle" &&
      addOperatorFetcher.data?.success &&
      addOperatorFetcher.data.operator
    ) {
      const op = addOperatorFetcher.data.operator;
      setShowAddModal(false);
      submitPinIn(op, op.pin);
      onDismiss?.();
    }
  }, [
    addOperatorFetcher.state,
    addOperatorFetcher.data,
    submitPinIn,
    onDismiss
  ]);

  // Focus search on mount
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const filteredPeople = useMemo(() => {
    const query = search.toLowerCase().trim();
    // Exclude the station user (they logged in directly, not an operator)
    let list = sessionUserId
      ? people.filter((p) => p.id !== sessionUserId)
      : people;
    // Filter by location if available
    if (locationEmployeeIds.length > 0) {
      list = list.filter((p) => locationEmployeeIds.includes(p.id));
    }
    const filtered = query
      ? list.filter((p) => p.name.toLowerCase().includes(query))
      : list;

    return [...filtered].sort((a, b) => {
      const aRecent = recentIds.indexOf(a.id);
      const bRecent = recentIds.indexOf(b.id);
      if (aRecent !== -1 && bRecent !== -1) return aRecent - bRecent;
      if (aRecent !== -1) return -1;
      if (bRecent !== -1) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [people, search, recentIds, locationEmployeeIds, sessionUserId]);

  const handlePinComplete = useCallback(
    (value: string) => {
      if (selectedPerson && value.length === 4) {
        submitPinIn(selectedPerson, value);
        onDismiss?.();
      }
    },
    [selectedPerson, submitPinIn, onDismiss]
  );

  const handlePinSubmit = useCallback(() => {
    if (selectedPerson) {
      submitPinIn(selectedPerson, pin);
      onDismiss?.();
    }
  }, [selectedPerson, pin, submitPinIn, onDismiss]);

  const handleAddOperator = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      addOperatorFetcher.submit(formData, {
        method: "POST",
        action: path.to.consoleAddOperator
      });
    },
    [addOperatorFetcher]
  );

  const handleBackdropClick = useCallback(() => {
    // Don't dismiss if add modal is open
    if (showAddModal) return;
    if (dismissable) onDismiss?.();
  }, [dismissable, onDismiss, showAddModal]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-sm mx-4 rounded-2xl border bg-card shadow-2xl overflow-hidden relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button — top right, outside the search bar */}
        {dismissable && (
          <button
            type="button"
            onClick={onDismiss}
            className="absolute top-2.5 right-2.5 z-10 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <LuX className="h-4 w-4" />
          </button>
        )}

        {/* Search */}
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <LuSearch className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search operators..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedPerson(null);
              setPin("");
              setPinError(null);
            }}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground pr-8"
          />
        </div>

        {/* Operator list */}
        <div className="max-h-[240px] overflow-y-auto">
          {filteredPeople.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {search ? "No results" : "No operators"}
            </div>
          ) : (
            <div className="py-1">
              {(() => {
                const recentPeople = filteredPeople.filter((p) =>
                  recentIds.includes(p.id)
                );
                const otherPeople = filteredPeople.filter(
                  (p) => !recentIds.includes(p.id)
                );

                const renderPerson = (person: Person) => {
                  const isSelected = selectedPerson?.id === person.id;
                  return (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => {
                        setSelectedPerson(isSelected ? null : person);
                        setPin("");
                        setPinError(null);
                      }}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        isSelected ? "bg-primary/5" : "hover:bg-muted/50"
                      }`}
                    >
                      <Avatar
                        size="xs"
                        name={person.name}
                        src={person.avatarUrl ?? undefined}
                      />
                      <span className="text-sm flex-1 truncate">
                        {person.name}
                      </span>
                      {isSelected && (
                        <LuCheck className="h-3.5 w-3.5 text-primary shrink-0" />
                      )}
                    </button>
                  );
                };

                // When searching, show flat list. When browsing, group recent at top.
                if (search) {
                  return <>{filteredPeople.map(renderPerson)}</>;
                }

                return (
                  <>
                    {recentPeople.length > 0 && (
                      <>
                        <p className="px-4 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          Recent
                        </p>
                        {recentPeople.map(renderPerson)}
                        {otherPeople.length > 0 && (
                          <div className="mx-4 my-1 border-t" />
                        )}
                      </>
                    )}
                    {otherPeople.map(renderPerson)}
                  </>
                );
              })()}
            </div>
          )}
        </div>

        {/* PIN input — only visible when someone is selected */}
        {selectedPerson && (
          <div className="border-t px-4 py-4">
            <div className="flex flex-col items-center gap-3">
              <p className="text-xs text-muted-foreground">
                Enter PIN for {selectedPerson.name}
              </p>
              <InputOTP
                maxLength={4}
                value={pin}
                onChange={(value) => {
                  setPin(value);
                  setPinError(null);
                }}
                onComplete={handlePinComplete}
                disabled={isPinning}
                autoFocus
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                </InputOTPGroup>
              </InputOTP>
              {pinError && (
                <p className="text-xs text-destructive">{pinError}</p>
              )}
              <Button
                size="sm"
                className="w-full"
                onClick={handlePinSubmit}
                disabled={isPinning || pin.length < 4}
              >
                {isPinning && (
                  <LuLoader className="mr-2 h-3.5 w-3.5 animate-spin" />
                )}
                Pin In
              </Button>
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="border-t px-4 py-2">
          <button
            type="button"
            onClick={() => {
              setGeneratedPin(generatePin());
              setShowAddModal(true);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <LuPlus className="h-4 w-4" />
            Add new operator
          </button>
          {hasPinnedUser && (
            <button
              type="button"
              onClick={() => {
                pinOutFetcher.submit(null, {
                  method: "POST",
                  action: path.to.consolePinOut
                });
                onDismiss?.();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LuLogOut className="h-4 w-4" />
              Pin Out
            </button>
          )}
        </div>
      </div>

      {showAddModal && (
        <AddOperatorModal
          generatedPin={generatedPin}
          onRegeneratePin={() => setGeneratedPin(generatePin())}
          onSubmit={handleAddOperator}
          isAdding={isAdding}
          error={
            addOperatorFetcher.data?.success === false
              ? addOperatorFetcher.data.message
              : null
          }
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}

function AddOperatorModal({
  generatedPin,
  onRegeneratePin,
  onSubmit,
  isAdding,
  error,
  onClose
}: {
  generatedPin: string;
  onRegeneratePin: () => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isAdding: boolean;
  error: string | null | undefined;
  onClose: () => void;
}) {
  const [editablePin, setEditablePin] = useState(generatedPin);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEditablePin(generatedPin);
    setCopied(false);
  }, [generatedPin]);

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <form onSubmit={onSubmit} className="flex flex-col h-full">
          <ModalHeader>
            <ModalTitle>Add New Operator</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    name="firstName"
                    placeholder="Enter first name"
                    required
                    disabled={isAdding}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    name="lastName"
                    placeholder="Enter last name"
                    required
                    disabled={isAdding}
                  />
                </div>
              </div>
              <div className="space-y-2 w-full">
                <Label htmlFor="pin">PIN</Label>
                <HStack>
                  <Input
                    id="pin"
                    name="pin"
                    value={editablePin}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 4);
                      setEditablePin(val);
                    }}
                    maxLength={4}
                    inputMode="numeric"
                    required
                    disabled={isAdding}
                    className="font-mono text-lg tracking-[0.3em] text-center"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(editablePin);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    disabled={isAdding}
                    title="Copy PIN"
                  >
                    {copied ? (
                      <LuCheck className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <LuCopy className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onRegeneratePin}
                    disabled={isAdding}
                    title="Generate new PIN"
                  >
                    <LuRefreshCw className="h-4 w-4" />
                  </Button>
                </HStack>
                <p className="text-xs text-muted-foreground">
                  Share this PIN with the operator so they can pin in at the
                  terminal.
                </p>
              </div>
              {error && (
                <p className="text-sm text-destructive">
                  {error ?? "Failed to add operator"}
                </p>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={isAdding}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isAdding || editablePin.length < 4}
              >
                {isAdding ? (
                  <LuLoader className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Add Operator
              </Button>
            </HStack>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
