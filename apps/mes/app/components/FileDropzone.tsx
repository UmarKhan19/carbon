import { cn } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useDropzone } from "react-dropzone";
import { LuCloudUpload } from "react-icons/lu";

interface FileDropzoneProps {
  onDrop: (acceptedFiles: File[]) => void;
}

const FileDropzone: React.FC<FileDropzoneProps> = ({ onDrop }) => {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: 1,
    multiple: false
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "mt-4 border-2 border-dashed rounded-md p-6 text-center hover:border-primary hover:bg-primary/10 w-full",
        isDragActive ? "border-primary bg-primary/10" : "border-muted"
      )}
    >
      <input {...getInputProps()} />
      <LuCloudUpload className="mx-auto h-12 w-12 text-muted-foreground" />
      <p className="mt-2 text-sm text-muted-foreground">
        <Trans>Drag and drop a file here, or click to select a file</Trans>
      </p>
    </div>
  );
};

export default FileDropzone;
