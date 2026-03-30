import { useCarbon } from "@carbon/auth";
import { ValidatedForm } from "@carbon/form";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  HStack,
  Label,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  toast,
  VStack
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { nanoid } from "nanoid";
import { useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Employee,
  Hidden,
  Input,
  Select,
  SelectControlled,
  Submit,
  TextArea
} from "~/components/Form";
import { usePermissions, useUser } from "~/hooks";
import {
  riskRegisterType,
  riskRegisterValidator,
  riskStatus
} from "~/modules/quality/quality.models";
import { getPrivateUrl, path } from "~/utils/path";
import { RiskRating } from "./RiskRating";
import RiskStatus from "./RiskStatus";

type RiskRegisterFormProps = {
  initialValues: Omit<
    z.infer<typeof riskRegisterValidator>,
    "severity" | "likelihood"
  > & { severity: string; likelihood: string; notes?: string | null };
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const RiskRegisterForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: RiskRegisterFormProps) => {
  const permissions = usePermissions();
  const {
    company: { id: companyId }
  } = useUser();
  const { carbon } = useCarbon();
  const fetcher = useFetcher<{
    data: { id: string } | null;
    error: any;
    success?: boolean;
  }>();

  const [selectedType, setSelectedType] = useState(
    initialValues.type || "Risk"
  );

  const [notes, setNotes] = useState<JSONContent>(() => {
    if (!initialValues?.notes) return {};
    if (typeof initialValues.notes === "object")
      return initialValues.notes as JSONContent;
    try {
      return JSON.parse(initialValues.notes) as JSONContent;
    } catch {
      return {};
    }
  });

  const onUploadImage = async (file: File) => {
    const fileType = file.name.split(".").pop();
    const fileName = `${companyId}/quality/${nanoid()}.${fileType}`;

    const result = await carbon?.storage.from("private").upload(fileName, file);

    if (result?.error) {
      toast.error("Failed to upload image");
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return getPrivateUrl(result.data.path);
  };

  const isEditing = !!initialValues.id;
  const isDisabled = isEditing
    ? !permissions.can("update", "quality")
    : !permissions.can("create", "quality");

  // Set default values for severity and likelihood
  const formInitialValues = {
    ...initialValues,
    severity: initialValues.severity ?? 1,
    likelihood: initialValues.likelihood ?? 1
  };

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(isOpen) => {
          // Prevent closing while submitting to avoid cancelling the request
          if (!isOpen && fetcher.state === "idle") {
            onClose?.();
          }
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={riskRegisterValidator}
            method="post"
            action={
              isEditing ? path.to.risk(initialValues.id!) : path.to.newRisk
            }
            defaultValues={formInitialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? "Edit" : "New"} {selectedType}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="source" />
              <Hidden name="sourceId" />
              <Hidden name="itemId" />
              <Hidden name="notes" value={JSON.stringify(notes)} />

              <VStack spacing={4}>
                <Input name="title" label="Title" />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 w-full">
                  <SelectControlled
                    name="type"
                    label="Type"
                    value={selectedType}
                    onChange={(value) =>
                      // @ts-expect-error TS2345 - TODO: fix type
                      setSelectedType(value?.value ?? "Risk")
                    }
                    options={riskRegisterType.map((t) => ({
                      value: t,
                      label: t
                    }))}
                  />

                  <Select
                    name="status"
                    label="Status"
                    options={riskStatus.map((s) => ({
                      value: s,
                      label: <RiskStatus status={s} />
                    }))}
                  />
                </div>
                <TextArea name="description" label="Description" />

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 w-full">
                  <Select
                    name="severity"
                    label="Severity"
                    options={Array.from({ length: 5 }, (_, index) => ({
                      value: (index + 1).toString(),
                      label: <RiskRating rating={index + 1} />
                    }))}
                  />
                  <Select
                    name="likelihood"
                    label="Likelihood"
                    options={Array.from({ length: 5 }, (_, index) => ({
                      value: (index + 1).toString(),
                      label: <RiskRating rating={index + 1} />
                    }))}
                  />
                </div>

                <Employee name="assignee" label="Assignee" />

                <div className="flex flex-col gap-2 w-full">
                  <Label>Notes</Label>
                  <Editor
                    initialValue={notes}
                    onUpload={onUploadImage}
                    onChange={(value) => {
                      setNotes(value);
                    }}
                    className="[&_.is-empty]:text-muted-foreground min-h-[120px] py-3 px-4 border rounded-md w-full"
                  />
                </div>
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>Save</Submit>
                <Button
                  size="md"
                  variant="solid"
                  onClick={() => onClose?.()}
                  isDisabled={fetcher.state !== "idle"}
                >
                  Cancel
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default RiskRegisterForm;
