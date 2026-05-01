import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  Input,
  InputGroup,
  InputRightElement,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ScrollArea,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import {
  LuCheck,
  LuCircleCheck,
  LuCircleX,
  LuList,
  LuQrCode,
  LuX
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { Hidden, Submit, TextArea } from "~/components/Form";
import { inboundInspectionSampleValidator } from "~/modules/quality/quality.models";
import type { InspectionTrackedEntity } from "~/modules/quality/types";
import { path } from "~/utils/path";

type Props = {
  inspectionId: string;
  remaining: InspectionTrackedEntity[];
  onClose: () => void;
};

export default function ScanInspectionSample({
  inspectionId,
  remaining,
  onClose
}: Props) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ error?: unknown; success?: boolean }>();

  const [serial, setSerial] = useState("");
  const [selected, setSelected] = useState<InspectionTrackedEntity | null>(
    null
  );
  const [pendingStatus, setPendingStatus] = useState<"Passed" | "Failed">(
    "Passed"
  );

  const findMatch = (value: string): InspectionTrackedEntity | null => {
    if (!value) return null;
    const needle = value.toLowerCase();
    return (
      remaining.find((e) => {
        if (e.id === value) return true;
        if (e.readableId && e.readableId.toLowerCase() === needle) return true;
        return false;
      }) ?? null
    );
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: keep findMatch around for future UI without re-introducing unused-variable churn
  useEffect(() => {
    setSelected(findMatch(serial));
  }, [serial, remaining]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      setSerial("");
      setSelected(null);
    }
  }, [fetcher.state, fetcher.data]);

  const isSubmitting = fetcher.state !== "idle";
  const hasSelection = !!selected;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent size="large">
        <ModalHeader>
          <ModalTitle>
            <Trans>Inspect Item</Trans>
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Scan or select a tracked entity from this lot and record the
              inspection result.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ValidatedForm
          key={selected?.id ?? "none"}
          fetcher={fetcher}
          method="post"
          action={`${path.to.inboundInspection(inspectionId)}/sample`}
          validator={inboundInspectionSampleValidator}
          defaultValues={{
            inspectionId,
            trackedEntityId: selected?.id ?? "",
            status: pendingStatus,
            notes: ""
          }}
        >
          <ModalBody>
            <VStack spacing={4} className="w-full">
              <Tabs defaultValue="scan" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-4">
                  <TabsTrigger value="scan">
                    <LuQrCode className="mr-2" />
                    <Trans>Scan</Trans>
                  </TabsTrigger>
                  <TabsTrigger value="select">
                    <LuList className="mr-2" />
                    <Trans>Select</Trans>
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="scan" className="mt-0 w-full">
                  <VStack spacing={3} className="w-full">
                    <InputGroup className="w-full">
                      <Input
                        autoFocus
                        placeholder={t`Scan or enter tracked entity ID, serial, or batch`}
                        value={serial}
                        onChange={(e) => setSerial(e.target.value)}
                      />
                      <InputRightElement>
                        {serial &&
                          (hasSelection ? (
                            <LuCheck className="text-green-500" />
                          ) : (
                            <LuX className="text-red-500" />
                          ))}
                      </InputRightElement>
                    </InputGroup>

                    {selected && (
                      <div className="w-full rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">
                          <Trans>Tracked Entity</Trans>
                        </div>
                        <div className="font-mono text-sm">
                          {selected.readableId ?? selected.id}
                        </div>
                        {selected.readableId && (
                          <div className="text-xs text-muted-foreground mt-1">
                            {selected.id}
                          </div>
                        )}
                      </div>
                    )}
                  </VStack>
                </TabsContent>
                <TabsContent value="select" className="mt-0 w-full">
                  <ScrollArea className="h-[40dvh] w-full">
                    <VStack spacing={2} className="w-full pr-3">
                      {remaining.length === 0 ? (
                        <p className="text-center text-muted-foreground w-full py-6">
                          <Trans>No remaining entities to inspect.</Trans>
                        </p>
                      ) : (
                        remaining.map((e) => {
                          const isSelected = selected?.id === e.id;
                          return (
                            <HStack
                              key={e.id}
                              className="w-full justify-between p-4 border rounded-md"
                            >
                              <VStack
                                spacing={0}
                                className="w-full items-start min-w-0"
                              >
                                <p className="font-mono text-sm truncate w-full">
                                  {e.readableId ?? e.id}
                                </p>
                                {e.readableId && (
                                  <p className="text-xs text-muted-foreground truncate w-full">
                                    {e.id}
                                  </p>
                                )}
                              </VStack>
                              <Button
                                size="sm"
                                variant={isSelected ? "primary" : "secondary"}
                                onClick={() => setSerial(e.id)}
                              >
                                {isSelected ? (
                                  <Trans>Selected</Trans>
                                ) : (
                                  <Trans>Select</Trans>
                                )}
                              </Button>
                            </HStack>
                          );
                        })
                      )}
                    </VStack>
                  </ScrollArea>
                </TabsContent>
              </Tabs>

              <Hidden name="inspectionId" value={inspectionId} />
              <Hidden name="trackedEntityId" value={selected?.id ?? ""} />
              <Hidden name="status" value={pendingStatus} />

              <TextArea
                name="notes"
                label={t`Notes`}
                isDisabled={!hasSelection}
              />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={2}>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Close</Trans>
              </Button>
              <Submit
                variant="destructive"
                leftIcon={<LuCircleX />}
                isDisabled={!hasSelection || isSubmitting}
                onClick={() => setPendingStatus("Failed")}
              >
                <Trans>Fail</Trans>
              </Submit>
              <Submit
                leftIcon={<LuCircleCheck />}
                isDisabled={!hasSelection || isSubmitting}
                onClick={() => setPendingStatus("Passed")}
              >
                <Trans>Pass</Trans>
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
