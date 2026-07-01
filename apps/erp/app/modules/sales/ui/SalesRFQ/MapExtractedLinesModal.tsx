import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Select as CarbonSelect,
  HStack,
  Input,
  Modal,
  ModalBody,
  ModalClose,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { z } from "zod";
import Item from "~/components/Form/Item";
import { path } from "~/utils/path";

const dummyValidator = z.object({});

export type MapExtractedLinesModalProps = {
  rfqId: string;
  customerId: string | undefined;
  onClose: () => void;
};

export default function MapExtractedLinesModal({
  rfqId,
  customerId,
  onClose
}: MapExtractedLinesModalProps) {
  const fetcher = useFetcher<any>();
  const [mappings, setMappings] = useState<any[]>([]);

  // Fetch suggestions
  useEffect(() => {
    if (fetcher.state === "idle" && !fetcher.data) {
      fetcher.load(
        `${path.to.api.salesRfq(rfqId)}/map-lines${
          customerId ? `?customerId=${customerId}` : ""
        }`
      );
    }
  }, [rfqId, customerId, fetcher]);

  useEffect(() => {
    if (fetcher.data?.data && mappings.length === 0) {
      const initialMappings = fetcher.data.data.map((item: any) => ({
        ...item,
        itemId: item.itemId || item.suggestedItemId
      }));
      setMappings(initialMappings);
    }
  }, [fetcher.data, mappings.length]);

  const handleActionChange = (lineId: string, action: string) => {
    setMappings((prev) =>
      prev.map((m) => (m.lineId === lineId ? { ...m, action } : m))
    );
  };

  const handleItemSelect = (lineId: string, item: any) => {
    setMappings((prev) =>
      prev.map((m) =>
        m.lineId === lineId
          ? {
              ...m,
              itemId: item?.value
            }
          : m
      )
    );
  };

  const handleCreateNameChange = (lineId: string, createName: string) => {
    setMappings((prev) =>
      prev.map((m) => (m.lineId === lineId ? { ...m, createName } : m))
    );
  };

  const handleSubmit = () => {
    const formData = new FormData();
    if (customerId) formData.append("customerId", customerId);
    formData.append("mappings", JSON.stringify(mappings));

    fetcher.submit(formData, {
      method: "post",
      action: `${path.to.api.salesRfq(rfqId)}/map-lines`
    });
  };

  useEffect(() => {
    if (fetcher.data?.success) {
      onClose();
    }
  }, [fetcher.data, onClose]);

  const isLoading = fetcher.state !== "idle";

  return (
    <Modal open={true} onOpenChange={(val) => !val && onClose()}>
      <ModalOverlay />
      <ModalContent size="xxlarge">
        <ValidatedForm validator={dummyValidator} onSubmit={handleSubmit}>
          <ModalHeader>
            <Trans>Map Extracted Lines</Trans>
            <ModalClose />
          </ModalHeader>
          <ModalBody className="max-h-[70vh] overflow-y-auto">
            <p className="text-sm text-muted-foreground mb-4">
              <Trans>
                Some lines extracted from the PDF could not be automatically
                mapped to your inventory items. Please map them below.
              </Trans>
            </p>

            <Table>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Extracted Part Number</Trans>
                  </Th>
                  <Th>
                    <Trans>Action</Trans>
                  </Th>
                  <Th>
                    <Trans>Target Item</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {mappings.length === 0 && isLoading && (
                  <Tr>
                    <Td colSpan={3} className="text-center py-4">
                      <Trans>Loading suggestions...</Trans>
                    </Td>
                  </Tr>
                )}
                {mappings.map((map) => (
                  <Tr key={map.lineId}>
                    <Td>
                      <VStack spacing={0}>
                        <p className="font-semibold">{map.customerPartId}</p>
                        <p className="text-xs text-muted-foreground">
                          {map.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Qty: {map.quantity?.[0]}
                        </p>
                      </VStack>
                    </Td>
                    <Td>
                      <CarbonSelect
                        value={map.action}
                        onValueChange={(val) =>
                          handleActionChange(map.lineId, val)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="map">Map to Existing</SelectItem>
                          <SelectItem value="create">
                            Create New Item
                          </SelectItem>
                          <SelectItem value="ignore">
                            Ignore (Leave Unmapped)
                          </SelectItem>
                        </SelectContent>
                      </CarbonSelect>
                    </Td>
                    <Td>
                      {map.action === "map" && (
                        <Item
                          type="Item"
                          name={`item-${map.lineId}`}
                          value={map.itemId}
                          onChange={(val) => handleItemSelect(map.lineId, val)}
                        />
                      )}
                      {map.action === "create" && (
                        <Input
                          placeholder="New Item Name"
                          value={
                            map.createName ??
                            map.description ??
                            map.customerPartId
                          }
                          onChange={(e) =>
                            handleCreateNameChange(map.lineId, e.target.value)
                          }
                        />
                      )}
                      {map.action === "ignore" && (
                        <p className="text-muted-foreground text-sm">
                          <Trans>Will remain as comment line</Trans>
                        </p>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={2} className="w-full justify-end">
              <ModalClose asChild>
                <Button variant="secondary" onClick={onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </ModalClose>
              <Button type="submit" isLoading={isLoading}>
                <Trans>Confirm Mapping</Trans>
              </Button>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
