"use client";

import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  VStack
} from "@carbon/react";
import { useState } from "react";
import { useFetcher } from "react-router";
import { Process } from "~/components/Form";

interface AssemblyMetadata {
  isAssembly: boolean;
  partCount: number;
  rootName?: string;
}

interface GenerateFromAssemblyModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobId: string;
  modelUploadId: string;
  assemblyMetadata: AssemblyMetadata;
}

export function GenerateFromAssemblyModal({
  isOpen,
  onClose,
  jobId,
  modelUploadId,
  assemblyMetadata
}: GenerateFromAssemblyModalProps) {
  const fetcher = useFetcher();
  const [processId, setProcessId] = useState<string>("");

  const isSubmitting = fetcher.state !== "idle";

  const handleSubmit = () => {
    if (!processId) {
      toast.error("Please select a process");
      return;
    }

    const formData = new FormData();
    formData.append("jobId", jobId);
    formData.append("modelUploadId", modelUploadId);
    formData.append("processId", processId);

    fetcher.submit(formData, {
      method: "POST",
      action: "/api/job/generate-from-assembly"
    });

    toast.success("Work instructions generation started");
    onClose();
  };

  return (
    <Modal open={isOpen} onOpenChange={onClose}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Generate Work Instructions from Assembly</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4}>
            <div className="text-sm text-muted-foreground">
              This will create job operations and steps based on the assembly
              structure of the CAD model.
            </div>
            <div className="bg-muted p-3 rounded-md text-sm">
              <div>
                <strong>Assembly:</strong>{" "}
                {assemblyMetadata.rootName ?? "Unknown"}
              </div>
              <div>
                <strong>Total Parts:</strong> {assemblyMetadata.partCount}
              </div>
            </div>
            <Process
              name="processId"
              label="Process"
              helperText="Select the process type for assembly operations"
              value={processId}
              onChange={(value) => setProcessId(value?.value ?? "")}
            />
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            isDisabled={!processId || isSubmitting}
            isLoading={isSubmitting}
          >
            Generate
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
