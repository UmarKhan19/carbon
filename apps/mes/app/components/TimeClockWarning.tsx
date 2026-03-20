"use client";

import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  VStack
} from "@carbon/react";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const CLOCK_STORAGE_KEY = "timeclock-warning-ack";
const BREAK_STORAGE_KEY = "timeclock-break-warning-ack";

type TimeClockWarningProps = {
  openClockEntry: {
    id: string;
    clockIn: string;
  } | null;
  breakEntry?: {
    clockOut: string;
  } | null;
};

export function TimeClockWarning({
  openClockEntry,
  breakEntry
}: TimeClockWarningProps) {
  const [showClockWarning, setShowClockWarning] = useState(false);
  const [showBreakWarning, setShowBreakWarning] = useState(false);
  const [editClockOut, setEditClockOut] = useState("");
  const fetcher = useFetcher();

  useEffect(() => {
    if (!openClockEntry) {
      setShowClockWarning(false);
      return;
    }

    const checkStale = () => {
      const elapsed = Date.now() - new Date(openClockEntry.clockIn).getTime();
      if (elapsed < TWELVE_HOURS_MS) {
        setShowClockWarning(false);
        return;
      }

      const acked = sessionStorage.getItem(CLOCK_STORAGE_KEY);
      if (acked === openClockEntry.id) {
        setShowClockWarning(false);
        return;
      }

      setShowClockWarning(true);
    };

    checkStale();
    const interval = setInterval(checkStale, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [openClockEntry]);

  useEffect(() => {
    if (!breakEntry) {
      setShowBreakWarning(false);
      return;
    }

    const checkBreak = () => {
      const elapsed = Date.now() - new Date(breakEntry.clockOut).getTime();
      if (elapsed < TWO_HOURS_MS) {
        setShowBreakWarning(false);
        return;
      }

      const acked = sessionStorage.getItem(BREAK_STORAGE_KEY);
      if (acked === breakEntry.clockOut) {
        setShowBreakWarning(false);
        return;
      }

      setShowBreakWarning(true);
    };

    checkBreak();
    const interval = setInterval(checkBreak, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [breakEntry]);

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      if ((fetcher.data as { success?: boolean }).success) {
        toast.success("Updated successfully");
        setShowClockWarning(false);
        setShowBreakWarning(false);
      }
    }
  }, [fetcher.data, fetcher.state]);

  const handleClockAcknowledge = () => {
    if (openClockEntry) {
      sessionStorage.setItem(CLOCK_STORAGE_KEY, openClockEntry.id);
    }
    setShowClockWarning(false);
  };

  const handleBreakAcknowledge = () => {
    if (breakEntry) {
      sessionStorage.setItem(BREAK_STORAGE_KEY, breakEntry.clockOut);
    }
    setShowBreakWarning(false);
  };

  const handleEditClockOut = () => {
    if (!editClockOut || !openClockEntry) return;
    const formData = new FormData();
    formData.append("intent", "clockOut");
    formData.append("clockOut", new Date(editClockOut).toISOString());
    fetcher.submit(formData, {
      method: "post",
      action: path.to.timeclock
    });
  };

  const handleClockBackIn = () => {
    const formData = new FormData();
    formData.append("intent", "clockIn");
    fetcher.submit(formData, {
      method: "post",
      action: path.to.timeclock
    });
  };

  if (showClockWarning && openClockEntry) {
    const hoursElapsed = Math.floor(
      (Date.now() - new Date(openClockEntry.clockIn).getTime()) / 3600000
    );

    return (
      <Modal
        open
        onOpenChange={() => {
          /* intentionally non-dismissable */
        }}
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Forgot to Clock Out?</ModalTitle>
            <ModalDescription>
              You&apos;ve been clocked in for {hoursElapsed} hours. Did you
              forget to clock out?
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <p className="text-sm text-muted-foreground">
                You clocked in at{" "}
                {new Date(openClockEntry.clockIn).toLocaleString()}. You can
                edit your clock-out time below or acknowledge that you&apos;re
                still working.
              </p>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">
                  Set clock-out time
                </label>
                <Input
                  type="datetime-local"
                  value={editClockOut}
                  onChange={(e) => setEditClockOut(e.target.value)}
                />
              </div>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={handleClockAcknowledge}>
              I&apos;m Still Working
            </Button>
            <Button
              onClick={handleEditClockOut}
              isDisabled={!editClockOut || fetcher.state !== "idle"}
              isLoading={fetcher.state !== "idle"}
            >
              Set Clock Out
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    );
  }

  if (showBreakWarning && breakEntry) {
    const hoursOnBreak = Math.floor(
      (Date.now() - new Date(breakEntry.clockOut).getTime()) / 3600000
    );

    return (
      <Modal
        open
        onOpenChange={() => {
          /* intentionally non-dismissable */
        }}
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Still on Break?</ModalTitle>
            <ModalDescription>
              You&apos;ve been on break for {hoursOnBreak} hours. Did you forget
              to clock back in?
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-muted-foreground">
              Your break started at{" "}
              {new Date(breakEntry.clockOut).toLocaleString()}. You can clock
              back in or dismiss this reminder.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={handleBreakAcknowledge}>
              Dismiss
            </Button>
            <Button
              onClick={handleClockBackIn}
              isDisabled={fetcher.state !== "idle"}
              isLoading={fetcher.state !== "idle"}
            >
              Clock Back In
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    );
  }

  return null;
}
