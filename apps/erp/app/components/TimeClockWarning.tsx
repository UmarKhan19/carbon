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
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STORAGE_KEY = "timeclock-warning-ack";

type TimeClockWarningProps = {
  openClockEntry: {
    id: string;
    clockIn: string;
  } | null;
};

export function TimeClockWarning({ openClockEntry }: TimeClockWarningProps) {
  const [showWarning, setShowWarning] = useState(false);
  const [editClockOut, setEditClockOut] = useState("");
  const fetcher = useFetcher();

  useEffect(() => {
    if (!openClockEntry) {
      setShowWarning(false);
      return;
    }

    const checkStale = () => {
      const elapsed = Date.now() - new Date(openClockEntry.clockIn).getTime();
      if (elapsed < TWELVE_HOURS_MS) {
        setShowWarning(false);
        return;
      }

      const acked = sessionStorage.getItem(STORAGE_KEY);
      if (acked === openClockEntry.id) {
        setShowWarning(false);
        return;
      }

      setShowWarning(true);
    };

    checkStale();
    const interval = setInterval(checkStale, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [openClockEntry]);

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      if ((fetcher.data as { success?: boolean }).success) {
        toast.success("Clock-out time updated");
        setShowWarning(false);
      }
    }
  }, [fetcher.data, fetcher.state]);

  const handleAcknowledge = () => {
    if (openClockEntry) {
      sessionStorage.setItem(STORAGE_KEY, openClockEntry.id);
    }
    setShowWarning(false);
  };

  const handleEditClockOut = () => {
    if (!editClockOut || !openClockEntry) return;
    const formData = new FormData();
    formData.append("intent", "clockOut");
    formData.append("clockOut", new Date(editClockOut).toISOString());
    fetcher.submit(formData, {
      method: "post",
      action: path.to.api.timeclock
    });
  };

  if (!showWarning || !openClockEntry) return null;

  const hoursElapsed = Math.floor(
    (Date.now() - new Date(openClockEntry.clockIn).getTime()) / 3600000
  );

  return (
    <Modal
      open={showWarning}
      onOpenChange={() => {
        /* intentionally non-dismissable */
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Forgot to Clock Out?</ModalTitle>
          <ModalDescription>
            You&apos;ve been clocked in for {hoursElapsed} hours. Did you forget
            to clock out?
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4}>
            <p className="text-sm text-muted-foreground">
              You clocked in at{" "}
              {new Date(openClockEntry.clockIn).toLocaleString()}. You can edit
              your clock-out time below or acknowledge that you&apos;re still
              working.
            </p>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Set clock-out time</label>
              <Input
                type="datetime-local"
                value={editClockOut}
                onChange={(e) => setEditClockOut(e.target.value)}
              />
            </div>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={handleAcknowledge}>
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
