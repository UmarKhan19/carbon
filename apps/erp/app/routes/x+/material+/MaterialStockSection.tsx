import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  NumberDecrementStepper,
  NumberField,
  NumberIncrementStepper,
  NumberInput,
  NumberInputGroup,
  NumberInputStepper,
  Select,
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
  VStack,
  useDisclosure
} from "@carbon/react";
import { formatStockDimensions, getStockRemaining } from "@carbon/utils";
import type { MaterialStockPiece } from "@carbon/utils";
import { useState } from "react";
import {
  LuChevronDown,
  LuChevronUp,
  LuCirclePlus,
  LuRuler
} from "react-icons/lu";
import { useFetcher, useLoaderData } from "react-router";
import type { loader } from "./$itemId.stock";

export function MaterialStockSection() {
  const { stockPieces, itemId } = useLoaderData<typeof loader>();
  const addModal = useDisclosure();
  const fetcher = useFetcher();

  const [newStockType, setNewStockType] = useState<
    "linear" | "sheet" | "block"
  >("linear");
  const [newStockLength, setNewStockLength] = useState<number>(0);
  const [newStockWidth, setNewStockWidth] = useState<number>(0);
  const [newStockHeight, setNewStockHeight] = useState<number>(0);
  const [newStockUnit, setNewStockUnit] = useState<string>("IN");
  const [newStockQty, setNewStockQty] = useState<number>(1);

  const handleAddStock = () => {
    let stockDimensions:
      | { type: "linear"; length: number }
      | { type: "sheet"; width: number; height: number }
      | { type: "block"; length: number; width: number; height: number };

    switch (newStockType) {
      case "linear":
        stockDimensions = { type: "linear", length: newStockLength };
        break;
      case "sheet":
        stockDimensions = {
          type: "sheet",
          width: newStockWidth,
          height: newStockHeight
        };
        break;
      case "block":
        stockDimensions = {
          type: "block",
          length: newStockLength,
          width: newStockWidth,
          height: newStockHeight
        };
        break;
    }

    fetcher.submit(
      JSON.stringify({
        materialId: itemId,
        stockDimensions,
        stockUnit: newStockUnit,
        quantity: newStockQty
      }),
      {
        method: "post",
        encType: "application/json"
      }
    );

    addModal.onClose();
    setNewStockLength(0);
    setNewStockWidth(0);
    setNewStockHeight(0);
    setNewStockQty(1);
  };

  return (
    <>
      <Card className="w-full">
        <HStack className="w-full justify-between">
          <CardHeader>
            <CardTitle>
              <HStack>
                <LuRuler className="h-5 w-5" />
                Material Stock
              </HStack>
            </CardTitle>
            <CardDescription>
              Physical pieces of this material with tracked dimensions
            </CardDescription>
          </CardHeader>
          <CardAction>
            <Button
              leftIcon={<LuCirclePlus />}
              onClick={addModal.onOpen}
            >
              Add Stock
            </Button>
          </CardAction>
        </HStack>
        <CardContent>
          {stockPieces.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              No stock pieces with dimensions. Add stock to start tracking
              material dimensions.
            </div>
          ) : (
            <Table className="table-fixed">
              <Thead>
                <Tr>
                  <Th>Dimensions</Th>
                  <Th>Remaining</Th>
                  <Th>Unit</Th>
                  <Th>Status</Th>
                  <Th>ID</Th>
                </Tr>
              </Thead>
              <Tbody>
                {stockPieces.map((piece) => (
                  <Tr key={piece.trackedEntityId}>
                    <Td>
                      <span className="font-medium">
                        {formatStockDimensions(
                          piece.stockDimensions,
                          piece.stockUnit
                        )}
                      </span>
                    </Td>
                    <Td>{getStockRemaining(piece.stockDimensions)}</Td>
                    <Td>{piece.stockUnit}</Td>
                    <Td>
                      <Badge
                        variant={
                          piece.status === "Available"
                            ? "default"
                            : "secondary"
                        }
                      >
                        {piece.status}
                      </Badge>
                      {piece.parentStockId && (
                        <Badge variant="outline" className="ml-1">
                          Remnant
                        </Badge>
                      )}
                    </Td>
                    <Td className="font-mono text-xs text-muted-foreground">
                      {piece.trackedEntityId.slice(0, 12)}...
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      {addModal.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) addModal.onClose();
          }}
        >
          <ModalContent>
            <ModalHeader>
              <ModalTitle>Add Material Stock</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <VStack spacing={4}>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Dimension Type
                  </label>
                  <Select
                    value={newStockType}
                    onValueChange={(v) =>
                      setNewStockType(v as "linear" | "sheet" | "block")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="linear">
                        Linear (Length)
                      </SelectItem>
                      <SelectItem value="sheet">
                        Sheet (Width x Height)
                      </SelectItem>
                      <SelectItem value="block">
                        Block (L x W x H)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {newStockType === "linear" && (
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Length
                    </label>
                    <NumberField
                      value={newStockLength}
                      onChange={setNewStockLength}
                      minValue={0.01}
                    >
                      <NumberInputGroup className="relative">
                        <NumberInput />
                        <NumberInputStepper>
                          <NumberIncrementStepper>
                            <LuChevronUp size="1em" strokeWidth="3" />
                          </NumberIncrementStepper>
                          <NumberDecrementStepper>
                            <LuChevronDown size="1em" strokeWidth="3" />
                          </NumberDecrementStepper>
                        </NumberInputStepper>
                      </NumberInputGroup>
                    </NumberField>
                  </div>
                )}
                {(newStockType === "sheet" || newStockType === "block") && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Width
                      </label>
                      <NumberField
                        value={newStockWidth}
                        onChange={setNewStockWidth}
                        minValue={0.01}
                      >
                        <NumberInputGroup className="relative">
                          <NumberInput />
                        </NumberInputGroup>
                      </NumberField>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Height
                      </label>
                      <NumberField
                        value={newStockHeight}
                        onChange={setNewStockHeight}
                        minValue={0.01}
                      >
                        <NumberInputGroup className="relative">
                          <NumberInput />
                        </NumberInputGroup>
                      </NumberField>
                    </div>
                  </div>
                )}
                {newStockType === "block" && (
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Length / Depth
                    </label>
                    <NumberField
                      value={newStockLength}
                      onChange={setNewStockLength}
                      minValue={0.01}
                    >
                      <NumberInputGroup className="relative">
                        <NumberInput />
                        <NumberInputStepper>
                          <NumberIncrementStepper>
                            <LuChevronUp size="1em" strokeWidth="3" />
                          </NumberIncrementStepper>
                          <NumberDecrementStepper>
                            <LuChevronDown size="1em" strokeWidth="3" />
                          </NumberDecrementStepper>
                        </NumberInputStepper>
                      </NumberInputGroup>
                    </NumberField>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Unit
                    </label>
                    <Select
                      value={newStockUnit}
                      onValueChange={setNewStockUnit}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="IN">Inches</SelectItem>
                        <SelectItem value="FT">Feet</SelectItem>
                        <SelectItem value="MM">mm</SelectItem>
                        <SelectItem value="CM">cm</SelectItem>
                        <SelectItem value="M">Meters</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      Qty (pieces)
                    </label>
                    <NumberField
                      value={newStockQty}
                      onChange={setNewStockQty}
                      minValue={1}
                    >
                      <NumberInputGroup className="relative">
                        <NumberInput />
                        <NumberInputStepper>
                          <NumberIncrementStepper>
                            <LuChevronUp size="1em" strokeWidth="3" />
                          </NumberIncrementStepper>
                          <NumberDecrementStepper>
                            <LuChevronDown size="1em" strokeWidth="3" />
                          </NumberDecrementStepper>
                        </NumberInputStepper>
                      </NumberInputGroup>
                    </NumberField>
                  </div>
                </div>
              </VStack>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={addModal.onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleAddStock}
                isLoading={fetcher.state !== "idle"}
              >
                Add Stock
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </>
  );
}
