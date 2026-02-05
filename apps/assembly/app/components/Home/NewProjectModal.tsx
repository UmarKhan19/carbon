import {
  Button,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import {
  BsCheck2Circle,
  BsCloudUpload,
  BsExclamationTriangle,
  BsFileEarmarkCode,
  BsX
} from "react-icons/bs";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

interface NewProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type PipelineStage =
  | "idle"
  | "uploading"
  | "parsing"
  | "simulating"
  | "done"
  | "error";

interface ProjectStatus {
  status: string;
  parsingProgress: number | null;
  parsingError: string | null;
  simulationStatus: string | null;
  simulationError: string | null;
}

function getPipelineStage(data: ProjectStatus | null): PipelineStage {
  if (!data) return "uploading";
  if (data.parsingError || data.simulationError) return "error";
  if (data.status === "preprocessing" || data.status === "parsing")
    return "parsing";
  if (data.status === "simulating") return "simulating";
  if (data.status === "editing" && data.simulationStatus === "completed")
    return "done";
  // If editing but simulation hasn't run yet, still consider done
  // (in case simulation was skipped or chaining hasn't kicked in yet)
  if (data.status === "editing") return "done";
  if (data.status === "failed") return "error";
  return "parsing";
}

function getErrorMessage(data: ProjectStatus | null): string {
  if (!data) return "Something went wrong";
  return data.parsingError || data.simulationError || "Something went wrong";
}

export function NewProjectModal({ open, onOpenChange }: NewProjectModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [stage, setStage] = useState<PipelineStage>("idle");

  const submitFetcher = useFetcher();
  const pollFetcher = useFetcher<ProjectStatus>();
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isSubmitting = submitFetcher.state !== "idle";

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setSelectedFile(acceptedFiles[0]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/step": [".step", ".stp", ".STEP", ".STP"]
    },
    maxFiles: 1
  });

  // Handle submit response — extract projectId
  useEffect(() => {
    if (submitFetcher.data && typeof submitFetcher.data === "object") {
      const data = submitFetcher.data as { projectId?: string; error?: string };
      if (data.projectId) {
        setProjectId(data.projectId);
        setStage("parsing");
      } else if (data.error) {
        setStage("error");
      }
    }
  }, [submitFetcher.data]);

  // Poll for project status once we have a projectId
  const pollFetcherLoadRef = useRef(pollFetcher.load);
  pollFetcherLoadRef.current = pollFetcher.load;

  useEffect(() => {
    if (!projectId || stage === "done" || stage === "error") {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    const poll = () => {
      pollFetcherLoadRef.current(`/x/api/project-status/${projectId}`);
    };

    // Poll immediately, then every 2s
    poll();
    pollTimerRef.current = setInterval(poll, 2000);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [projectId, stage]);

  // Update stage from poll data
  useEffect(() => {
    if (pollFetcher.data) {
      const newStage = getPipelineStage(pollFetcher.data);
      setStage(newStage);
    }
  }, [pollFetcher.data]);

  const handleSubmit = () => {
    if (!selectedFile || !projectName.trim()) return;

    setStage("uploading");

    const formData = new FormData();
    formData.set("intent", "createProject");
    formData.set("name", projectName.trim());
    formData.set("file", selectedFile);

    submitFetcher.submit(formData, {
      method: "POST",
      encType: "multipart/form-data"
    });
  };

  const handleReset = () => {
    setSelectedFile(null);
    setProjectName("");
    setProjectId(null);
    setStage("idle");
  };

  const handleClose = () => {
    if (stage === "done") {
      // Reset for next time
      handleReset();
    }
    onOpenChange(false);
  };

  const showUploadForm = stage === "idle";

  return (
    <Modal open={open} onOpenChange={handleClose}>
      <ModalContent
        size="large"
        withCloseButton={
          stage === "idle" || stage === "done" || stage === "error"
        }
      >
        {showUploadForm ? (
          <>
            <ModalHeader>
              <ModalTitle>New Project</ModalTitle>
              <ModalDescription>
                Upload a STEP file to create assembly instructions with
                automated disassembly simulation.
              </ModalDescription>
            </ModalHeader>

            <ModalBody>
              <div className="space-y-5">
                {/* Project Name */}
                <div className="space-y-2">
                  <Label htmlFor="modal-project-name">Project Name</Label>
                  <Input
                    id="modal-project-name"
                    placeholder="e.g., Motor Assembly Instructions"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    autoFocus
                  />
                </div>

                {/* File Upload */}
                <div className="space-y-2">
                  <Label>STEP File</Label>
                  <div
                    {...getRootProps()}
                    className={`
                      border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
                      ${isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"}
                    `}
                  >
                    <input {...getInputProps()} />
                    {selectedFile ? (
                      <div className="flex items-center justify-center gap-3">
                        <BsFileEarmarkCode className="w-8 h-8 text-primary" />
                        <div className="text-left">
                          <p className="font-medium">{selectedFile.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFile(null);
                          }}
                        >
                          <BsX className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <BsCloudUpload className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                        <p className="font-medium">
                          {isDragActive
                            ? "Drop file here"
                            : "Drop STEP file here or click to browse"}
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">
                          Supports .step and .stp files
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </ModalBody>

            <ModalFooter>
              <Button variant="secondary" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!selectedFile || !projectName.trim() || isSubmitting}
              >
                {isSubmitting ? "Creating..." : "Create Project"}
              </Button>
            </ModalFooter>
          </>
        ) : (
          <>
            <ModalHeader>
              <ModalTitle>
                {stage === "done"
                  ? "Project Ready!"
                  : stage === "error"
                    ? "Something went wrong"
                    : "Setting up your project..."}
              </ModalTitle>
              <ModalDescription>
                {stage === "done"
                  ? "Your assembly instructions are ready to edit."
                  : stage === "error"
                    ? "There was a problem processing your file."
                    : "This usually takes 1-3 minutes depending on model complexity."}
              </ModalDescription>
            </ModalHeader>

            <ModalBody>
              <div className="space-y-4 py-2">
                <PipelineStep
                  label="Uploading file"
                  status={
                    stage === "uploading"
                      ? "active"
                      : stage === "error" && !projectId
                        ? "error"
                        : projectId
                          ? "done"
                          : "pending"
                  }
                />
                <PipelineStep
                  label="Parsing CAD model"
                  detail={
                    stage === "parsing" && pollFetcher.data?.parsingProgress
                      ? `${pollFetcher.data.parsingProgress}%`
                      : undefined
                  }
                  status={
                    stage === "parsing"
                      ? "active"
                      : stage === "error" && pollFetcher.data?.parsingError
                        ? "error"
                        : stage === "simulating" || stage === "done"
                          ? "done"
                          : "pending"
                  }
                />
                <PipelineStep
                  label="Running simulation"
                  status={
                    stage === "simulating"
                      ? "active"
                      : stage === "error" && pollFetcher.data?.simulationError
                        ? "error"
                        : stage === "done"
                          ? "done"
                          : "pending"
                  }
                />
                <PipelineStep
                  label="Ready to edit"
                  status={stage === "done" ? "done" : "pending"}
                />
              </div>

              {stage === "error" && (
                <div className="mt-4 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  {getErrorMessage(pollFetcher.data ?? null)}
                </div>
              )}
            </ModalBody>

            <ModalFooter>
              {stage === "error" && (
                <Button variant="secondary" onClick={handleReset}>
                  Try Again
                </Button>
              )}
              {stage === "done" && projectId && (
                <Button asChild>
                  <a href={path.to.projectEdit(projectId)}>Open Project</a>
                </Button>
              )}
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

function PipelineStep({
  label,
  detail,
  status
}: {
  label: string;
  detail?: string;
  status: "pending" | "active" | "done" | "error";
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
        {status === "done" && (
          <BsCheck2Circle className="w-5 h-5 text-green-600" />
        )}
        {status === "active" && (
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        )}
        {status === "pending" && (
          <div className="w-3 h-3 rounded-full bg-muted-foreground/20" />
        )}
        {status === "error" && (
          <BsExclamationTriangle className="w-5 h-5 text-destructive" />
        )}
      </div>
      <span
        className={`text-sm ${
          status === "active"
            ? "font-medium text-foreground"
            : status === "done"
              ? "text-muted-foreground"
              : status === "error"
                ? "text-destructive font-medium"
                : "text-muted-foreground/60"
        }`}
      >
        {label}
        {detail && (
          <span className="ml-2 text-xs text-muted-foreground">({detail})</span>
        )}
      </span>
    </div>
  );
}
