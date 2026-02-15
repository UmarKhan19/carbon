import { useCarbon } from "@carbon/auth";
import {
  Input as FormInput,
  Number as FormNumberInput,
  Hidden,
  ValidatedForm
} from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  Combobox as ComboboxBase,
  cn,
  IconButton,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useDisclosure
} from "@carbon/react";

import { getItemReadableId } from "@carbon/utils";
import { useNumberFormatter } from "@react-aria/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LuArrowRightLeft,
  LuCheck,
  LuChevronDown,
  LuChevronUp,
  LuCirclePlus,
  LuGitBranch,
  LuList,
  LuPrinter,
  LuQrCode,
  LuScale,
  LuTrash,
  LuUndo2,
  LuX
} from "react-icons/lu";
import { useFetcher } from "react-router";
import type {
  getBatchNumbersForItem,
  getSerialNumbersForItem
} from "~/services/inventory.service";
import { convertEntityValidator, issueValidator } from "~/services/models";
import { getAvailableMaterialStock } from "~/services/operations.service";
import type { JobMaterial, TrackedInput } from "~/services/types";
import type { MaterialStockPiece } from "~/types/materialStock.types";
import { formatStockDimensions } from "~/types/materialStock.types";
import { useItems } from "~/stores";
import { path } from "~/utils/path";

type TrackingType = "Serial" | "Batch" | "Inventory" | null;

interface ItemDetails {
  id: string;
  name: string;
  unitOfMeasureCode: string;
  itemTrackingType: TrackingType;
}

export function IssueMaterialModal({
  operationId,
  material,
  parentId,
  parentIdIsSerialized,
  trackedInputs = [],
  onClose
}: {
  operationId: string;
  material?: JobMaterial;
  parentId?: string;
  parentIdIsSerialized?: boolean;
  trackedInputs?: TrackedInput[];
  onClose: () => void;
}) {
  const { carbon } = useCarbon();
  const [items] = useItems();
  const numberFormatter = useNumberFormatter({ maximumFractionDigits: 4 });

  // Item selection state
  const [selectedItemId, setSelectedItemId] = useState<string>(
    material?.itemId ?? ""
  );
  const [itemDetails, setItemDetails] = useState<ItemDetails | null>(null);
  const [isLoadingItem, setIsLoadingItem] = useState(false);

  // Determine tracking type from material or item details
  const trackingType: TrackingType = useMemo(() => {
    if (material) {
      if (material.requiresSerialTracking) return "Serial";
      if (material.requiresBatchTracking) return "Batch";
      return "Inventory";
    }
    return itemDetails?.itemTrackingType ?? null;
  }, [material, itemDetails]);

  // Item options for the combobox
  const itemOptions = useMemo(() => {
    return items.map((item) => ({
      label: item.readableIdWithRevision,
      helper: item.name,
      value: item.id
    }));
  }, [items]);

  // Serial number state and options
  const { data: serialNumbers } = useSerialNumbers(
    trackingType === "Serial" ? selectedItemId : undefined
  );
  const serialOptions = useMemo(() => {
    return (
      serialNumbers?.data?.map((sn) => ({
        label: sn.id ?? "",
        value: sn.id,
        helper: sn.readableId ? `Serial ${sn.readableId}` : undefined
      })) ?? []
    );
  }, [serialNumbers]);

  // Batch number state and options
  const { data: batchNumbers } = useBatchNumbers(
    trackingType === "Batch" ? selectedItemId : undefined
  );
  const batchOptions = useMemo(() => {
    return (
      batchNumbers?.data
        ?.filter((bn) => bn.status === "Available")
        .map((bn) => {
          return {
            label: bn.sourceDocumentReadableId ?? "",
            value: bn.id,
            helper: bn.readableId
              ? `${bn.id.slice(0, 10)} - ${bn.quantity} Available of Batch ${bn.readableId}`
              : `${bn.id.slice(0, 10)} - ${bn.quantity} Available`,
            availableQuantity: bn.quantity
          };
        }) ?? []
    );
  }, [batchNumbers]);

  // Unconsume options for batch
  const unconsumeOptions = useMemo(() => {
    return trackedInputs.map((input) => ({
      label: input.id,
      value: input.id,
      helper: `${input.quantity} ${input.readableId ? `of Batch ${input.readableId}` : ""}`
    }));
  }, [trackedInputs]);

  // Quantity for inventory items
  const initialQuantity = useMemo(() => {
    if (!material) return 1;
    return parentIdIsSerialized
      ? (material.quantity ?? material.estimatedQuantity ?? 1)
      : (material.estimatedQuantity ?? material.quantity ?? 1);
  }, [material, parentIdIsSerialized]);

  const [quantity, setQuantity] = useState(initialQuantity);

  // Serial numbers selection state
  const [selectedSerialNumbers, setSelectedSerialNumbers] = useState<
    Array<{ index: number; id: string }>
  >(
    Array(Math.max(1, initialQuantity))
      .fill("")
      .map((_, index) => ({ index, id: "" }))
  );
  const [serialErrors, setSerialErrors] = useState<Record<number, string>>({});
  const [selectedTrackedInputs, setSelectedTrackedInputs] = useState<string[]>(
    []
  );

  // Batch numbers selection state
  const [selectedBatchNumbers, setSelectedBatchNumbers] = useState<
    Array<{ index: number; id: string; quantity: number }>
  >([{ index: 0, id: "", quantity: initialQuantity }]);
  const [batchErrors, setBatchErrors] = useState<Record<number, string>>({});
  const [unconsumedBatch, setUnconsumedBatch] = useState("");

  // Material stock selection state (for materials with stock dimensions)
  const {
    data: materialStockPieces,
    isLoading: isLoadingStock,
    refresh: refreshStock
  } = useMaterialStock(
    material?.itemType === "Material" ? selectedItemId : undefined
  );
  
  // Debug: Log when materialStockPieces changes
  useEffect(() => {
    console.log("materialStockPieces updated:", materialStockPieces?.length ?? 0, "pieces");
  }, [materialStockPieces]);
  const [selectedStockId, setSelectedStockId] = useState<string>("");
  const [stockCutAmount, setStockCutAmount] = useState<number>(initialQuantity);
  const [remnantLength, setRemnantLength] = useState<number>(0);
  const [remnantWidth, setRemnantWidth] = useState<number>(0);
  const [remnantHeight, setRemnantHeight] = useState<number>(0);
  const hasStockPieces = (materialStockPieces?.length ?? 0) > 0;
  const isMaterial = material?.itemType === "Material";
  const requiresDimensionTracking = (material as unknown as { requiresDimensionTracking?: boolean })?.requiresDimensionTracking ?? false;

  // Auto-populate remnant dimensions from selected stock
  useEffect(() => {
    if (selectedStockId && materialStockPieces) {
      const selectedStock = materialStockPieces.find(
        (s) => s.trackedEntityId === selectedStockId
      );
      if (selectedStock) {
        // Initialize remnant dimensions to match the stock
        // User can then reduce them as needed
        setRemnantLength(selectedStock.stockDimensions.length);
        setRemnantWidth(selectedStock.stockDimensions.width);
        setRemnantHeight(selectedStock.stockDimensions.height);
      }
    }
  }, [selectedStockId, materialStockPieces]);

  // Add stock form state
  const [showAddStock, setShowAddStock] = useState(false);
  const [newStockLength, setNewStockLength] = useState<number>(0);
  const [newStockWidth, setNewStockWidth] = useState<number>(0);
  const [newStockHeight, setNewStockHeight] = useState<number>(0);
  const [newStockUnit, setNewStockUnit] = useState<string>("IN");
  const [newStockQty, setNewStockQty] = useState<number>(1);

  // Tab state
  const [activeTab, setActiveTab] = useState("scan");

  // Split entities result state (for batch splitting)
  const [splitEntitiesResult, setSplitEntitiesResult] = useState<
    {
      newId: string;
      originalId: string;
      quantity: number;
      readableId?: string;
    }[]
  >([]);

  // Fetchers
  const fetcher = useFetcher<{
    success: boolean;
    message: string;
    splitEntities?: Array<{
      originalId: string;
      newId: string;
      quantity: number;
      readableId?: string;
    }>;
  }>();
  const unconsumeFetcher = useFetcher<{ success: boolean; message: string }>();
  const inventoryFetcher = useFetcher<{ success: boolean; message: string }>();
  const stockFetcher = useFetcher<{
    success: boolean;
    message: string;
    remnantId?: string;
  }>();
  const addStockFetcher = useFetcher<{
    success: boolean;
    message: string;
    createdIds?: string[];
  }>();

  // Sub-modals for batch splitting
  const convertDisclosure = useDisclosure();
  const scrapDisclosure = useDisclosure();
  const [trackedEntity, setTrackedEntity] = useState<string | null>(null);

  // Fetch item details when item is selected (only when no material provided)
  const handleItemChange = useCallback(
    async (itemId: string) => {
      setSelectedItemId(itemId);
      setItemDetails(null);
      setQuantity(1);
      setSelectedSerialNumbers([{ index: 0, id: "" }]);
      setSelectedBatchNumbers([{ index: 0, id: "", quantity: 1 }]);
      setSerialErrors({});
      setBatchErrors({});

      if (itemId && carbon && !material) {
        setIsLoadingItem(true);
        const { data } = await carbon
          .from("item")
          .select("id, name, unitOfMeasureCode, itemTrackingType")
          .eq("id", itemId)
          .single();

        if (data) {
          setItemDetails(data as ItemDetails);
        }
        setIsLoadingItem(false);
      }
    },
    [carbon, material]
  );

  // Validation functions
  const validateSerialNumber = useCallback(
    (value: string, index: number) => {
      if (!value) return "Serial number is required";
      const isDuplicate = selectedSerialNumbers.some(
        (sn, i) => sn.id === value && i !== index
      );
      if (isDuplicate) return "Duplicate serial number";
      const isValid = serialOptions.some((opt) => opt.value === value);
      if (!isValid) {
        const sn = serialNumbers?.data?.find((s) => s.id === value);
        if (sn) return `Serial number is ${sn.status}`;
        return "Serial number is not available";
      }
      return null;
    },
    [selectedSerialNumbers, serialOptions, serialNumbers?.data]
  );

  const validateBatchNumber = useCallback(
    (value: string, qty: number, index: number) => {
      if (!value) return "Batch number is required";
      const isDuplicate = selectedBatchNumbers.some(
        (bn, i) => bn.id === value && i !== index
      );
      if (isDuplicate) return "Duplicate batch number";
      const batchOption = batchOptions.find((opt) => opt.value === value);
      if (!batchOption) {
        const bn = batchNumbers?.data?.find((b) => b.id === value);
        if (bn) return `Batch number is ${bn.status}`;
        return "Batch number is not available";
      }
      if (qty <= 0) return "Quantity must be greater than 0";
      if (qty > batchOption.availableQuantity)
        return `Quantity cannot exceed available quantity (${batchOption.availableQuantity})`;
      return null;
    },
    [selectedBatchNumbers, batchOptions, batchNumbers?.data]
  );

  // Update functions for serial numbers
  const updateSerialNumber = useCallback(
    (serialNumber: { index: number; id: string }) => {
      setSelectedSerialNumbers((prev) => {
        const newSerialNumbers = [...prev];
        newSerialNumbers[serialNumber.index] = serialNumber;
        return newSerialNumbers;
      });
    },
    []
  );

  const addSerialNumber = useCallback(() => {
    setSelectedSerialNumbers((prev) => {
      const newIndex = prev.length;
      return [...prev, { index: newIndex, id: "" }];
    });
  }, []);

  const removeSerialNumber = useCallback((indexToRemove: number) => {
    setSelectedSerialNumbers((prev) => {
      const filtered = prev.filter((_, i) => i !== indexToRemove);
      return filtered.map((item, i) => ({ ...item, index: i }));
    });
    setSerialErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[indexToRemove];
      const reindexedErrors: Record<number, string> = {};
      Object.entries(newErrors).forEach(([key, value]) => {
        const keyNum = parseInt(key);
        if (keyNum > indexToRemove) {
          reindexedErrors[keyNum - 1] = value;
        } else {
          reindexedErrors[keyNum] = value;
        }
      });
      return reindexedErrors;
    });
  }, []);

  // Update functions for batch numbers
  const updateBatchNumber = useCallback(
    (batchNumber: { index: number; id: string; quantity: number }) => {
      setSelectedBatchNumbers((prev) => {
        const newBatchNumbers = [...prev];
        newBatchNumbers[batchNumber.index] = batchNumber;
        return newBatchNumbers;
      });
    },
    []
  );

  const addBatchNumber = useCallback(() => {
    setSelectedBatchNumbers((prev) => {
      const newIndex = prev.length;
      return [...prev, { index: newIndex, id: "", quantity: 1 }];
    });
  }, []);

  const removeBatchNumber = useCallback((indexToRemove: number) => {
    setSelectedBatchNumbers((prev) => {
      const filtered = prev.filter((_, i) => i !== indexToRemove);
      return filtered.map((item, i) => ({ ...item, index: i }));
    });
    setBatchErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[indexToRemove];
      const reindexedErrors: Record<number, string> = {};
      Object.entries(newErrors).forEach(([key, value]) => {
        const keyNum = parseInt(key);
        if (keyNum > indexToRemove) {
          reindexedErrors[keyNum - 1] = value;
        } else {
          reindexedErrors[keyNum] = value;
        }
      });
      return reindexedErrors;
    });
  }, []);

  const validateBatchInput = useCallback(
    (value: string, index: number) => {
      if (!value) {
        setBatchErrors((prev) => ({
          ...prev,
          [index]: "Batch number is required"
        }));
        return false;
      }

      const duplicateIndices = selectedBatchNumbers
        .map((bn, i) => (bn.id === value && i !== index ? i : -1))
        .filter((i) => i !== -1);

      if (duplicateIndices.length > 0) {
        setBatchErrors((prev) => ({
          ...prev,
          [index]: "Duplicate batch number"
        }));
        return false;
      }

      const batchOption = batchOptions.find((opt) => opt.value === value);
      if (!batchOption) {
        setBatchErrors((prev) => ({
          ...prev,
          [index]: "Batch number is not available"
        }));
        return false;
      }

      const currentBatchNumber = selectedBatchNumbers[index];
      if (currentBatchNumber.quantity > batchOption.availableQuantity) {
        const remainingQuantity =
          currentBatchNumber.quantity - batchOption.availableQuantity;

        updateBatchNumber({
          ...currentBatchNumber,
          id: value,
          quantity: batchOption.availableQuantity
        });

        setSelectedBatchNumbers((prev) => {
          const newIndex = prev.length;
          return [
            ...prev,
            { index: newIndex, id: "", quantity: remainingQuantity }
          ];
        });
      }

      setBatchErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[index];
        return newErrors;
      });
      return true;
    },
    [selectedBatchNumbers, batchOptions, updateBatchNumber]
  );

  const toggleTrackedInput = useCallback((id: string) => {
    setSelectedTrackedInputs((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      }
      return [...prev, id];
    });
  }, []);

  // Submit handlers
  const handleSubmitSerial = useCallback(() => {
    if (!parentId) {
      toast.error("Parent tracking ID is required for serial tracked items.");
      return;
    }

    // Either material.id or (operationId + selectedItemId) must be provided
    if (!material?.id && !selectedItemId) {
      toast.error("Please select an item to issue.");
      return;
    }

    let hasErrors = false;
    const newErrors: Record<number, string> = {};

    selectedSerialNumbers.forEach((sn) => {
      const error = validateSerialNumber(sn.id, sn.index);
      if (error) {
        newErrors[sn.index] = error;
        hasErrors = true;
      }
    });

    setSerialErrors(newErrors);

    if (!hasErrors) {
      const payload = material?.id
        ? {
            materialId: material.id,
            parentTrackedEntityId: parentId,
            children: selectedSerialNumbers.map((sn) => ({
              trackedEntityId: sn.id,
              quantity: 1
            }))
          }
        : {
            jobOperationId: operationId,
            itemId: selectedItemId,
            parentTrackedEntityId: parentId,
            children: selectedSerialNumbers.map((sn) => ({
              trackedEntityId: sn.id,
              quantity: 1
            }))
          };

      fetcher.submit(JSON.stringify(payload), {
        method: "post",
        action: path.to.issueTrackedEntity,
        encType: "application/json"
      });
    }
  }, [
    selectedSerialNumbers,
    validateSerialNumber,
    parentId,
    material?.id,
    operationId,
    selectedItemId,
    fetcher
  ]);

  const handleSubmitBatch = useCallback(() => {
    if (!parentId) {
      toast.error("Parent tracking ID is required for batch tracked items.");
      return;
    }

    // Either material.id or (operationId + selectedItemId) must be provided
    if (!material?.id && !selectedItemId) {
      toast.error("Please select an item to issue.");
      return;
    }

    let hasErrors = false;
    const newErrors: Record<number, string> = {};

    selectedBatchNumbers.forEach((bn) => {
      const error = validateBatchNumber(bn.id, bn.quantity, bn.index);
      if (error) {
        newErrors[bn.index] = error;
        hasErrors = true;
      }
    });

    setBatchErrors(newErrors);

    if (!hasErrors) {
      const payload = material?.id
        ? {
            materialId: material.id,
            parentTrackedEntityId: parentId,
            children: selectedBatchNumbers.map((bn) => ({
              trackedEntityId: bn.id,
              quantity: bn.quantity
            }))
          }
        : {
            jobOperationId: operationId,
            itemId: selectedItemId,
            parentTrackedEntityId: parentId,
            children: selectedBatchNumbers.map((bn) => ({
              trackedEntityId: bn.id,
              quantity: bn.quantity
            }))
          };

      fetcher.submit(JSON.stringify(payload), {
        method: "post",
        action: path.to.issueTrackedEntity,
        encType: "application/json"
      });
    }
  }, [
    selectedBatchNumbers,
    validateBatchNumber,
    parentId,
    material?.id,
    operationId,
    selectedItemId,
    fetcher
  ]);

  const handleUnconsumeSerial = useCallback(() => {
    if (selectedTrackedInputs.length === 0) {
      toast.error("Please select at least one item to unconsume");
      return;
    }

    if (!material?.id || !parentId) {
      toast.error("Material and parent ID are required to unconsume");
      return;
    }

    const payload = {
      materialId: material.id,
      parentTrackedEntityId: parentId,
      children: selectedTrackedInputs.map((id) => ({
        trackedEntityId: id,
        quantity: 1
      }))
    };

    unconsumeFetcher.submit(JSON.stringify(payload), {
      method: "post",
      action: path.to.unconsume,
      encType: "application/json"
    });
  }, [selectedTrackedInputs, material?.id, parentId, unconsumeFetcher]);

  const handleUnconsumeBatch = useCallback(() => {
    if (!unconsumedBatch) {
      toast.error("Please select a batch to unconsume");
      return;
    }

    if (!material?.id || !parentId) {
      toast.error("Material and parent ID are required to unconsume");
      return;
    }

    const payload = {
      materialId: material.id,
      parentTrackedEntityId: parentId,
      children: [
        {
          trackedEntityId: unconsumedBatch,
          quantity:
            trackedInputs.find((input) => input.id === unconsumedBatch)
              ?.quantity ?? 0
        }
      ]
    };

    unconsumeFetcher.submit(JSON.stringify(payload), {
      method: "post",
      action: path.to.unconsume,
      encType: "application/json"
    });
  }, [
    unconsumedBatch,
    material?.id,
    parentId,
    trackedInputs,
    unconsumeFetcher
  ]);

  // Submit handler for material stock
  const handleSubmitStock = useCallback(() => {
    if (!selectedStockId) {
      toast.error("Please select a stock piece to cut from");
      return;
    }

    const selectedStock = materialStockPieces?.find(
      (s) => s.trackedEntityId === selectedStockId
    );
    if (!selectedStock) {
      toast.error("Selected stock piece not found");
      return;
    }

    const { length: availLength, width: availWidth, height: availHeight } = selectedStock.stockDimensions;

    // Validate remnant dimensions are not negative
    if (remnantLength < 0 || remnantWidth < 0 || remnantHeight < 0) {
      toast.error("Remnant dimensions cannot be negative");
      return;
    }

    // Validate remnant dimensions don't exceed original stock
    if (remnantLength > availLength) {
      toast.error(
        `Remnant length (${remnantLength}) cannot exceed original stock length (${availLength} ${selectedStock.stockUnit})`
      );
      return;
    }
    if (remnantWidth > availWidth) {
      toast.error(
        `Remnant width (${remnantWidth}) cannot exceed original stock width (${availWidth} ${selectedStock.stockUnit})`
      );
      return;
    }
    if (remnantHeight > availHeight) {
      toast.error(
        `Remnant height (${remnantHeight}) cannot exceed original stock height (${availHeight} ${selectedStock.stockUnit})`
      );
      return;
    }

    // Calculate consumed amount (we'll use the reduction in length for the ledger)
    const consumedLength = availLength - remnantLength;

    const payload = {
      sourceStockId: selectedStockId,
      consumedAmount: consumedLength,
      remnantDimensions: {
        length: remnantLength,
        width: remnantWidth,
        height: remnantHeight
      },
      jobMaterialId: material?.id
    };

    stockFetcher.submit(JSON.stringify(payload), {
      method: "post",
      action: path.to.issueFromStock,
      encType: "application/json"
    });
  }, [
    selectedStockId,
    remnantLength,
    remnantWidth,
    remnantHeight,
    materialStockPieces,
    material?.id,
    stockFetcher
  ]);

  // Submit handler for adding new stock
  const handleAddStock = useCallback(() => {
    if (newStockLength <= 0 || newStockWidth <= 0 || newStockHeight <= 0) {
      toast.error("All dimensions (L, W, H) must be greater than 0");
      return;
    }

    const stockDimensions = {
      length: newStockLength,
      width: newStockWidth,
      height: newStockHeight,
      originalLength: newStockLength,
      originalWidth: newStockWidth,
      originalHeight: newStockHeight
    };

    const payload = {
      materialId: selectedItemId,
      stockDimensions,
      stockUnit: newStockUnit,
      quantity: newStockQty
    };

    addStockFetcher.submit(JSON.stringify(payload), {
      method: "post",
      action: path.to.addStock,
      encType: "application/json"
    });
  }, [
    newStockLength,
    newStockWidth,
    newStockHeight,
    newStockUnit,
    newStockQty,
    selectedItemId,
    addStockFetcher
  ]);

  // Handle fetcher responses
  const processedFetcherData = useRef<typeof fetcher.data | null>(null);

  useEffect(() => {
    if (
      fetcher.state === "idle" &&
      fetcher.data &&
      fetcher.data !== processedFetcherData.current
    ) {
      processedFetcherData.current = fetcher.data;

      if (fetcher.data.success) {
        if (
          fetcher.data.splitEntities &&
          fetcher.data.splitEntities.length > 0
        ) {
          setSplitEntitiesResult(
            fetcher.data.splitEntities.map((entity) => ({
              newId: entity.newId,
              originalId: entity.originalId,
              readableId: entity.readableId,
              quantity: entity.quantity
            }))
          );
          toast.success(fetcher.data.message);
        } else {
          onClose();
          if (fetcher.data.message) {
            toast.success(fetcher.data.message);
          }
        }
      } else if (fetcher.data.message) {
        toast.error(fetcher.data.message);
      }
    }
  }, [fetcher.state, fetcher.data, onClose]);

  useEffect(() => {
    if (unconsumeFetcher.data?.success) {
      onClose();
      if (unconsumeFetcher.data.message) {
        toast.success(unconsumeFetcher.data.message);
      }
    } else if (unconsumeFetcher.data?.message) {
      toast.error(unconsumeFetcher.data.message);
    }
  }, [unconsumeFetcher.data, onClose]);

  useEffect(() => {
    if (inventoryFetcher.data?.success) {
      onClose();
    }
  }, [inventoryFetcher.data, onClose]);

  useEffect(() => {
    if (stockFetcher.data?.success) {
      toast.success(stockFetcher.data.message || "Material issued from stock");
      if (stockFetcher.data.remnantId) {
        toast.info(
          `Remnant created: ${stockFetcher.data.remnantId.slice(0, 10)}...`
        );
      }
      // Refresh stock list after a delay to ensure database transaction completes
      setTimeout(() => {
        console.log("Refreshing stock list after cut...");
        refreshStock();
        // Reset selection so user can select the remnant for next cut
        setSelectedStockId("");
      }, 1000);
    } else if (stockFetcher.data?.message && !stockFetcher.data?.success) {
      toast.error(stockFetcher.data.message);
    }
  }, [stockFetcher.data, refreshStock]);

  useEffect(() => {
    if (addStockFetcher.data?.success) {
      toast.success(addStockFetcher.data.message || "Stock added");
      setShowAddStock(false);
      setNewStockLength(0);
      setNewStockWidth(0);
      setNewStockHeight(0);
      setNewStockQty(1);
      refreshStock();
    } else if (addStockFetcher.data?.message && !addStockFetcher.data?.success) {
      toast.error(addStockFetcher.data.message);
    }
  }, [addStockFetcher.data, refreshStock]);

  // Determine what to render based on state
  const showItemSelector = !material?.itemId;
  const showContent = material?.itemId || itemDetails;

  const hasTrackedInputs = trackedInputs.length > 0;

  return (
    <>
      <Modal open onOpenChange={onClose}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              {material?.description ??
                getItemReadableId(items, selectedItemId) ??
                "Issue Material"}
            </ModalTitle>
            {!material && (
              <ModalDescription>
                Select an item and specify the quantity to issue
              </ModalDescription>
            )}
          </ModalHeader>

          {splitEntitiesResult.length > 0 ? (
            // Show split entities result
            <ModalBody>
              <Alert variant="default" className="mb-4">
                <LuGitBranch className="mr-2" />
                <AlertTitle>Batch Split Occurred</AlertTitle>
                <AlertDescription>
                  <div className="flex flex-col gap-2">
                    <p>A new batch entity was created from a split:</p>
                    <ul className="list-disc list-inside space-y-1">
                      {splitEntitiesResult.map((split) => (
                        <li key={split.newId} className="flex flex-col text-sm">
                          <span className="text-md font-semibold">
                            {split.readableId ??
                              getItemReadableId(items, material?.itemId) ??
                              "Material"}
                          </span>
                          <div className="flex gap-2 items-center">
                            <span className="font-mono flex gap-1 items-center">
                              <LuQrCode />
                              {split.newId}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground flex gap-1 items-center truncate">
                              <LuScale />
                              {numberFormatter.format(split.quantity)}
                            </span>
                          </div>
                          <div className="flex gap-2 mt-4">
                            <Button
                              variant="primary"
                              leftIcon={<LuPrinter />}
                              onClick={() => {
                                window.open(
                                  window.location.origin +
                                    path.to.file.trackedEntityLabelPdf(
                                      split.newId
                                    ),
                                  "_blank"
                                );
                              }}
                            >
                              Print Label
                            </Button>
                            <Button
                              variant="secondary"
                              leftIcon={<LuArrowRightLeft />}
                              onClick={() => {
                                setTrackedEntity(split.newId);
                                convertDisclosure.onOpen();
                              }}
                            >
                              Convert
                            </Button>
                            <Button
                              variant="secondary"
                              leftIcon={<LuTrash />}
                              onClick={() => {
                                setTrackedEntity(split.newId);
                                scrapDisclosure.onOpen();
                              }}
                            >
                              Scrap
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </AlertDescription>
              </Alert>
            </ModalBody>
          ) : trackingType === "Inventory" || trackingType === null ? (
            // Inventory item - use ValidatedForm
            <ValidatedForm
              method="post"
              action={path.to.issue}
              onSubmit={onClose}
              validator={issueValidator}
              defaultValues={{
                materialId: material?.id ?? "",
                jobOperationId: operationId,
                itemId: selectedItemId,
                quantity:
                  (material?.estimatedQuantity ?? 0) -
                  (material?.quantityIssued ?? 0),
                adjustmentType: "Negative Adjmt."
              }}
              fetcher={inventoryFetcher}
            >
              <ModalBody>
                <Hidden name="jobOperationId" />
                <Hidden name="materialId" />
                {material?.id && (
                  <Hidden name="adjustmentType" value="Negative Adjmt." />
                )}
                <div className="flex flex-col gap-4">
                  {showItemSelector && (
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Item
                      </label>
                      <ComboboxBase
                        placeholder="Select an item..."
                        value={selectedItemId}
                        onChange={(value) => {
                          handleItemChange(value);
                        }}
                        options={itemOptions}
                      />
                      <input
                        type="hidden"
                        name="itemId"
                        value={selectedItemId}
                      />
                    </div>
                  )}
                  {material?.id && (
                    <Hidden name="itemId" value={selectedItemId} />
                  )}

                  {isLoadingItem && (
                    <div className="text-sm text-muted-foreground">
                      Loading item details...
                    </div>
                  )}

                  {showContent && trackingType === "Inventory" && (
                    <>
                      {/* Show stock selection for Material-type items with dimension tracking */}
                      {(isMaterial && (hasStockPieces || showAddStock)) || (requiresDimensionTracking && isMaterial) ? (
                        <div className="flex flex-col gap-4">
                          {/* Stock list + add button */}
                          {!showAddStock && hasStockPieces ? (
                            <>
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <label className="block text-sm font-medium">
                                    Available Stock
                                  </label>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    leftIcon={<LuCirclePlus />}
                                    onClick={() => setShowAddStock(true)}
                                  >
                                    Add Stock
                                  </Button>
                                </div>
                                {isLoadingStock ? (
                                  <div className="text-sm text-muted-foreground">
                                    Loading available stock...
                                  </div>
                                ) : (
                                  <div className="flex flex-col gap-2 max-h-48 overflow-y-auto border rounded-md p-2">
                                    {materialStockPieces?.map((stock) => (
                                      <div
                                        key={stock.trackedEntityId}
                                        className={cn(
                                          "flex items-center gap-3 p-3 border rounded-md cursor-pointer hover:bg-accent transition-colors",
                                          selectedStockId ===
                                            stock.trackedEntityId &&
                                            "border-primary bg-accent"
                                        )}
                                        onClick={() =>
                                          setSelectedStockId(
                                            stock.trackedEntityId
                                          )
                                        }
                                        onKeyDown={(e) => {
                                          if (
                                            e.key === "Enter" ||
                                            e.key === " "
                                          ) {
                                            setSelectedStockId(
                                              stock.trackedEntityId
                                            );
                                          }
                                        }}
                                        role="button"
                                        tabIndex={0}
                                      >
                                        <input
                                          type="radio"
                                          checked={
                                            selectedStockId ===
                                            stock.trackedEntityId
                                          }
                                          onChange={() =>
                                            setSelectedStockId(
                                              stock.trackedEntityId
                                            )
                                          }
                                          className="h-4 w-4"
                                        />
                                        <div className="flex-1">
                                          <div className="font-medium text-sm">
                                            {formatStockDimensions(
                                              stock.stockDimensions,
                                              stock.stockUnit
                                            )}{" "}
                                            remaining
                                          </div>
                                          <div className="text-xs text-muted-foreground">
                                            ID:{" "}
                                            {stock.trackedEntityId.slice(0, 10)}
                                            ...
                                            {stock.parentStockId &&
                                              " (Remnant)"}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div>
                                <label className="block text-sm font-medium mb-1">
                                  Remnant Dimensions (after cut)
                                </label>
                                <p className="text-xs text-muted-foreground mb-2">
                                  Enter the dimensions of the remaining piece. Each must be ≤ original.
                                </p>
                                <div className="grid grid-cols-3 gap-2">
                                  <div>
                                    <label className="block text-xs text-muted-foreground mb-1">
                                      Length
                                    </label>
                                    <NumberField
                                      value={remnantLength}
                                      onChange={setRemnantLength}
                                      minValue={0}
                                    >
                                      <NumberInputGroup className="relative">
                                        <NumberInput />
                                      </NumberInputGroup>
                                    </NumberField>
                                  </div>
                                  <div>
                                    <label className="block text-xs text-muted-foreground mb-1">
                                      Width
                                    </label>
                                    <NumberField
                                      value={remnantWidth}
                                      onChange={setRemnantWidth}
                                      minValue={0}
                                    >
                                      <NumberInputGroup className="relative">
                                        <NumberInput />
                                      </NumberInputGroup>
                                    </NumberField>
                                  </div>
                                  <div>
                                    <label className="block text-xs text-muted-foreground mb-1">
                                      Height
                                    </label>
                                    <NumberField
                                      value={remnantHeight}
                                      onChange={setRemnantHeight}
                                      minValue={0}
                                    >
                                      <NumberInputGroup className="relative">
                                        <NumberInput />
                                      </NumberInputGroup>
                                    </NumberField>
                                  </div>
                                </div>
                                {selectedStockId && (
                                  <span className="text-xs text-muted-foreground mt-1">
                                    Unit: {
                                      materialStockPieces?.find(
                                        (s) =>
                                          s.trackedEntityId ===
                                          selectedStockId
                                      )?.stockUnit
                                    }
                                  </span>
                                )}
                              </div>
                            </>
                          ) : (
                            /* Add Stock Form */
                            <div className="flex flex-col gap-4">
                              <div className="flex items-center justify-between">
                                <label className="block text-sm font-medium">
                                  Add Stock
                                </label>
                                {hasStockPieces && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setShowAddStock(false)}
                                  >
                                    Back to Stock List
                                  </Button>
                                )}
                              </div>
                              <div className="grid grid-cols-3 gap-2">
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
                                    </NumberInputGroup>
                                  </NumberField>
                                </div>
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
                                          <LuChevronUp
                                            size="1em"
                                            strokeWidth="3"
                                          />
                                        </NumberIncrementStepper>
                                        <NumberDecrementStepper>
                                          <LuChevronDown
                                            size="1em"
                                            strokeWidth="3"
                                          />
                                        </NumberDecrementStepper>
                                      </NumberInputStepper>
                                    </NumberInputGroup>
                                  </NumberField>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : isMaterial && !hasStockPieces && !isLoadingStock && !showAddStock ? (
                        /* No stock pieces yet for this material - show add stock prompt */
                        <div className="flex flex-col gap-4">
                          {requiresDimensionTracking ? (
                            <Alert variant="warning">
                              <AlertTitle>Dimension Tracking Required</AlertTitle>
                              <AlertDescription>
                                This material requires dimension tracking. You must add stock with dimensions before issuing.
                              </AlertDescription>
                            </Alert>
                          ) : (
                            <div className="text-sm text-muted-foreground text-center py-4">
                              No stock pieces with dimensions found for this
                              material.
                            </div>
                          )}
                          <Button
                            variant="secondary"
                            leftIcon={<LuCirclePlus />}
                            onClick={() => setShowAddStock(true)}
                          >
                            Add Stock with Dimensions
                          </Button>
                        </div>
                      ) : (showAddStock && requiresDimensionTracking && !hasStockPieces) ? (
                        /* Show Add Stock form when dimension tracking required and no stock */
                        <div className="flex flex-col gap-4">
                          <Alert variant="warning">
                            <AlertTitle>Dimension Tracking Required</AlertTitle>
                            <AlertDescription>
                              Add stock with dimensions to issue this material.
                            </AlertDescription>
                          </Alert>
                          {/* Add Stock Form - Block dimensions (L × W × H) */}
                          <div className="grid grid-cols-3 gap-2">
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
                                </NumberInputGroup>
                              </NumberField>
                            </div>
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
                                      <LuChevronUp
                                        size="1em"
                                        strokeWidth="3"
                                      />
                                    </NumberIncrementStepper>
                                    <NumberDecrementStepper>
                                      <LuChevronDown
                                        size="1em"
                                        strokeWidth="3"
                                      />
                                    </NumberDecrementStepper>
                                  </NumberInputStepper>
                                </NumberInputGroup>
                              </NumberField>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          {!material?.id && (
                            <div>
                              <label className="block text-sm font-medium mb-1">
                                Adjustment Type
                              </label>
                              <Select
                                name="adjustmentType"
                                defaultValue="Negative Adjmt."
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Positive Adjmt.">
                                    Add to Inventory
                                  </SelectItem>
                                  <SelectItem value="Negative Adjmt.">
                                    Pull from Inventory
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                          <div>
                            <label className="block text-sm font-medium mb-1">
                              Quantity
                            </label>

                            <NumberField
                              value={quantity}
                              onChange={setQuantity}
                              minValue={0.01}
                            >
                              <NumberInputGroup className="relative">
                                <NumberInput name="quantity" />
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
                        </>
                      )}
                    </>
                  )}
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                {showAddStock ? (
                  <Button
                    variant="primary"
                    onClick={handleAddStock}
                    isLoading={addStockFetcher.state !== "idle"}
                    isDisabled={addStockFetcher.state !== "idle"}
                  >
                    Add Stock
                  </Button>
                ) : hasStockPieces && isMaterial ? (
                  <Button
                    variant="primary"
                    onClick={handleSubmitStock}
                    isLoading={stockFetcher.state !== "idle"}
                    isDisabled={
                      stockFetcher.state !== "idle" ||
                      !selectedStockId ||
                      remnantLength < 0 ||
                      remnantWidth < 0 ||
                      remnantHeight < 0
                    }
                  >
                    Issue from Stock
                  </Button>
                ) : requiresDimensionTracking && isMaterial && !hasStockPieces ? (
                  /* Block issue when dimension tracking required but no stock */
                  <Button
                    variant="primary"
                    isDisabled
                    title="Add stock with dimensions first"
                  >
                    Issue (Stock Required)
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    variant="primary"
                    isLoading={inventoryFetcher.state !== "idle"}
                    isDisabled={
                      inventoryFetcher.state !== "idle" ||
                      !selectedItemId ||
                      isLoadingItem
                    }
                  >
                    Issue
                  </Button>
                )}
              </ModalFooter>
            </ValidatedForm>
          ) : (
            // Tracked items (Serial or Batch)
            <>
              <ModalBody>
                <div className="flex flex-col gap-4">
                  {showItemSelector && (
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Item
                      </label>
                      <ComboboxBase
                        placeholder="Select an item..."
                        value={selectedItemId}
                        onChange={handleItemChange}
                        options={itemOptions}
                      />
                    </div>
                  )}

                  {isLoadingItem && (
                    <div className="text-sm text-muted-foreground">
                      Loading item details...
                    </div>
                  )}

                  {showContent && trackingType === "Serial" && (
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                      <TabsList
                        className={cn(
                          "grid w-full grid-cols-2 mb-4",
                          hasTrackedInputs && "grid-cols-3"
                        )}
                      >
                        <TabsTrigger value="scan">
                          <LuQrCode className="mr-2" />
                          Scan
                        </TabsTrigger>
                        <TabsTrigger value="select">
                          <LuList className="mr-2" />
                          Select
                        </TabsTrigger>
                        {hasTrackedInputs && (
                          <TabsTrigger value="unconsume">
                            <LuUndo2 className="mr-2" />
                            Unconsume
                          </TabsTrigger>
                        )}
                      </TabsList>

                      <TabsContent value="scan">
                        <div className="flex flex-col gap-4">
                          {selectedSerialNumbers.map((sn, index) => (
                            <div
                              key={`${index}-serial-scan`}
                              className="flex flex-col gap-1"
                            >
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <InputGroup>
                                    <Input
                                      placeholder={`Serial Number ${index + 1}`}
                                      value={sn.id}
                                      onChange={(e) => {
                                        const newValue = e.target.value;
                                        const newSerialNumbers = [
                                          ...selectedSerialNumbers
                                        ];
                                        newSerialNumbers[index] = {
                                          index,
                                          id: newValue
                                        };
                                        setSelectedSerialNumbers(
                                          newSerialNumbers
                                        );
                                      }}
                                      onBlur={(e) => {
                                        const newValue = e.target.value;
                                        const error = validateSerialNumber(
                                          newValue,
                                          index
                                        );
                                        setSerialErrors((prev) => {
                                          const newErrors = { ...prev };
                                          if (error) {
                                            newErrors[index] = error;
                                          } else {
                                            delete newErrors[index];
                                          }
                                          return newErrors;
                                        });
                                        if (!error) {
                                          updateSerialNumber({
                                            index,
                                            id: newValue
                                          });
                                        } else {
                                          const newSerialNumbers = [
                                            ...selectedSerialNumbers
                                          ];
                                          newSerialNumbers[index] = {
                                            index,
                                            id: ""
                                          };
                                          setSelectedSerialNumbers(
                                            newSerialNumbers
                                          );
                                        }
                                      }}
                                      className={cn(
                                        serialErrors[index] &&
                                          "border-destructive"
                                      )}
                                    />
                                    <InputRightElement className="pl-2">
                                      {!serialErrors[index] && sn.id ? (
                                        <LuCheck className="text-emerald-500" />
                                      ) : (
                                        <LuQrCode />
                                      )}
                                    </InputRightElement>
                                  </InputGroup>
                                </div>
                                {index > 0 && (
                                  <IconButton
                                    aria-label="Remove Serial Number"
                                    icon={<LuX />}
                                    variant="ghost"
                                    onClick={() => removeSerialNumber(index)}
                                    className="flex-shrink-0"
                                  />
                                )}
                              </div>
                              {serialErrors[index] && (
                                <span className="text-xs text-destructive">
                                  {serialErrors[index]}
                                </span>
                              )}
                            </div>
                          ))}
                          <div>
                            <Button
                              type="button"
                              variant="secondary"
                              leftIcon={<LuCirclePlus />}
                              onClick={addSerialNumber}
                            >
                              Add
                            </Button>
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="select">
                        <div className="flex flex-col gap-4">
                          {selectedSerialNumbers.map((sn, index) => (
                            <div
                              key={`${index}-serial-select`}
                              className="flex flex-col gap-1"
                            >
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <ComboboxBase
                                    placeholder={`Select Serial Number ${index + 1}`}
                                    value={sn.id}
                                    onChange={(value) => {
                                      const newSerialNumbers = [
                                        ...selectedSerialNumbers
                                      ];
                                      newSerialNumbers[index] = {
                                        index,
                                        id: value
                                      };
                                      setSelectedSerialNumbers(
                                        newSerialNumbers
                                      );
                                      const error = validateSerialNumber(
                                        value,
                                        index
                                      );
                                      setSerialErrors((prev) => {
                                        const newErrors = { ...prev };
                                        if (error) {
                                          newErrors[index] = error;
                                        } else {
                                          delete newErrors[index];
                                        }
                                        return newErrors;
                                      });
                                    }}
                                    options={serialOptions}
                                  />
                                </div>
                                {index > 0 && (
                                  <IconButton
                                    aria-label="Remove Serial Number"
                                    icon={<LuX />}
                                    variant="ghost"
                                    onClick={() => removeSerialNumber(index)}
                                    className="flex-shrink-0"
                                  />
                                )}
                              </div>
                              {serialErrors[index] && (
                                <span className="text-xs text-destructive">
                                  {serialErrors[index]}
                                </span>
                              )}
                            </div>
                          ))}
                          <div>
                            <Button
                              type="button"
                              variant="secondary"
                              leftIcon={<LuCirclePlus />}
                              onClick={addSerialNumber}
                            >
                              Add
                            </Button>
                          </div>
                        </div>
                      </TabsContent>

                      {hasTrackedInputs && (
                        <TabsContent value="unconsume">
                          <div className="flex flex-col gap-4">
                            {trackedInputs.map((input) => (
                              <div
                                key={input.id}
                                className="flex items-center gap-3 p-2 border rounded-md"
                              >
                                <Checkbox
                                  id={`unconsume-${input.id}`}
                                  checked={selectedTrackedInputs.includes(
                                    input.id
                                  )}
                                  onCheckedChange={() =>
                                    toggleTrackedInput(input.id)
                                  }
                                />
                                <label
                                  htmlFor={`unconsume-${input.id}`}
                                  className="flex-1 cursor-pointer"
                                >
                                  <div className="font-medium text-sm">
                                    {input.id}
                                  </div>
                                  {input.readableId && (
                                    <div className="text-xs text-muted-foreground">
                                      Serial: {input.readableId}
                                    </div>
                                  )}
                                </label>
                              </div>
                            ))}
                            {trackedInputs.length === 0 && (
                              <Alert variant="warning">
                                <AlertTitle>No consumed materials</AlertTitle>
                                <AlertDescription>
                                  There are no consumed materials to unconsume.
                                </AlertDescription>
                              </Alert>
                            )}
                          </div>
                        </TabsContent>
                      )}
                    </Tabs>
                  )}

                  {showContent && trackingType === "Batch" && (
                    <Tabs value={activeTab} onValueChange={setActiveTab}>
                      <TabsList
                        className={cn(
                          "grid w-full grid-cols-2 mb-4",
                          hasTrackedInputs && "grid-cols-3"
                        )}
                      >
                        <TabsTrigger value="scan">
                          <LuQrCode className="mr-2" />
                          Scan
                        </TabsTrigger>
                        <TabsTrigger value="select">
                          <LuList className="mr-2" />
                          Select
                        </TabsTrigger>
                        {hasTrackedInputs && (
                          <TabsTrigger value="unconsume">
                            <LuUndo2 className="mr-2" />
                            Unconsume
                          </TabsTrigger>
                        )}
                      </TabsList>

                      <TabsContent value="scan">
                        <div className="flex flex-col gap-4">
                          {selectedBatchNumbers.map((batch, index) => (
                            <div key={index} className="flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <InputGroup>
                                    <Input
                                      value={batch.id}
                                      onChange={(e) => {
                                        const newValue = e.target.value;
                                        updateBatchNumber({
                                          ...batch,
                                          id: newValue
                                        });
                                      }}
                                      onBlur={(e) => {
                                        validateBatchInput(
                                          e.target.value,
                                          index
                                        );
                                      }}
                                      placeholder="Scan batch number"
                                    />
                                    <InputRightElement className="pl-2">
                                      {!batchErrors[index] && batch.id ? (
                                        <LuCheck className="text-emerald-500" />
                                      ) : (
                                        <LuQrCode />
                                      )}
                                    </InputRightElement>
                                  </InputGroup>
                                </div>
                                <div className="w-24">
                                  <NumberField
                                    id={`quantity-${index}`}
                                    value={batch.quantity}
                                    onChange={(value) =>
                                      updateBatchNumber({
                                        ...batch,
                                        quantity: value
                                      })
                                    }
                                    minValue={0.01}
                                    maxValue={
                                      batchOptions.find(
                                        (o) => o.value === batch.id
                                      )?.availableQuantity ?? 999999
                                    }
                                  >
                                    <NumberInputGroup className="relative">
                                      <NumberInput />
                                      <NumberInputStepper>
                                        <NumberIncrementStepper>
                                          <LuChevronUp
                                            size="1em"
                                            strokeWidth="3"
                                          />
                                        </NumberIncrementStepper>
                                        <NumberDecrementStepper>
                                          <LuChevronDown
                                            size="1em"
                                            strokeWidth="3"
                                          />
                                        </NumberDecrementStepper>
                                      </NumberInputStepper>
                                    </NumberInputGroup>
                                  </NumberField>
                                </div>
                                {index > 0 && (
                                  <IconButton
                                    aria-label="Remove Batch Number"
                                    icon={<LuX />}
                                    variant="ghost"
                                    onClick={() => removeBatchNumber(index)}
                                  />
                                )}
                              </div>
                              {batchErrors[index] && (
                                <span className="text-xs text-destructive">
                                  {batchErrors[index]}
                                </span>
                              )}
                            </div>
                          ))}
                          <div>
                            <Button
                              type="button"
                              variant="secondary"
                              leftIcon={<LuCirclePlus />}
                              onClick={addBatchNumber}
                            >
                              Add
                            </Button>
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="select">
                        <div className="flex flex-col gap-4">
                          {selectedBatchNumbers.map((batch, index) => (
                            <div key={index} className="flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                <div className="flex-1">
                                  <ComboboxBase
                                    value={batch.id}
                                    onChange={(value) => {
                                      updateBatchNumber({
                                        ...batch,
                                        id: value
                                      });
                                      validateBatchInput(value, index);
                                    }}
                                    options={batchOptions}
                                    placeholder="Select batch number"
                                  />
                                </div>
                                <div className="w-24">
                                  <NumberField
                                    value={batch.quantity}
                                    onChange={(value) =>
                                      updateBatchNumber({
                                        ...batch,
                                        quantity: value
                                      })
                                    }
                                    minValue={0.01}
                                    maxValue={
                                      batchOptions.find(
                                        (o) => o.value === batch.id
                                      )?.availableQuantity ?? 999999
                                    }
                                  >
                                    <NumberInputGroup className="relative">
                                      <NumberInput />
                                      <NumberInputStepper>
                                        <NumberIncrementStepper>
                                          <LuChevronUp
                                            size="1em"
                                            strokeWidth="3"
                                          />
                                        </NumberIncrementStepper>
                                        <NumberDecrementStepper>
                                          <LuChevronDown
                                            size="1em"
                                            strokeWidth="3"
                                          />
                                        </NumberDecrementStepper>
                                      </NumberInputStepper>
                                    </NumberInputGroup>
                                  </NumberField>
                                </div>
                                {index > 0 && (
                                  <IconButton
                                    aria-label="Remove Batch Number"
                                    icon={<LuX />}
                                    variant="ghost"
                                    onClick={() => removeBatchNumber(index)}
                                  />
                                )}
                              </div>
                              {batchErrors[index] && (
                                <span className="text-xs text-destructive">
                                  {batchErrors[index]}
                                </span>
                              )}
                            </div>
                          ))}
                          <div>
                            <Button
                              type="button"
                              variant="secondary"
                              leftIcon={<LuCirclePlus />}
                              onClick={addBatchNumber}
                            >
                              Add Batch
                            </Button>
                          </div>
                        </div>
                      </TabsContent>

                      {hasTrackedInputs && (
                        <TabsContent value="unconsume">
                          <div className="flex flex-col gap-4">
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <ComboboxBase
                                  value={unconsumedBatch}
                                  onChange={setUnconsumedBatch}
                                  options={unconsumeOptions}
                                  placeholder="Select batch to unconsume"
                                />
                              </div>
                              {unconsumedBatch && (
                                <div className="w-24">
                                  <Input
                                    isReadOnly
                                    value={
                                      trackedInputs
                                        .find(
                                          (input) =>
                                            input.id === unconsumedBatch
                                        )
                                        ?.quantity.toString() ?? "0"
                                    }
                                  />
                                </div>
                              )}
                            </div>
                            <div className="h-8" />
                          </div>
                        </TabsContent>
                      )}
                    </Tabs>
                  )}
                </div>
              </ModalBody>
              <ModalFooter>
                {splitEntitiesResult.length > 0 ? (
                  <Button variant="primary" onClick={onClose}>
                    Close
                  </Button>
                ) : (
                  <>
                    <Button variant="secondary" onClick={onClose}>
                      Cancel
                    </Button>
                    {activeTab === "unconsume" ? (
                      <Button
                        variant="destructive"
                        onClick={
                          trackingType === "Serial"
                            ? handleUnconsumeSerial
                            : handleUnconsumeBatch
                        }
                        isLoading={unconsumeFetcher.state !== "idle"}
                        isDisabled={
                          unconsumeFetcher.state !== "idle" ||
                          (trackingType === "Serial"
                            ? selectedTrackedInputs.length === 0
                            : !unconsumedBatch)
                        }
                      >
                        Unconsume
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        onClick={
                          trackingType === "Serial"
                            ? handleSubmitSerial
                            : handleSubmitBatch
                        }
                        isLoading={fetcher.state !== "idle"}
                        isDisabled={
                          fetcher.state !== "idle" ||
                          !selectedItemId ||
                          isLoadingItem
                        }
                      >
                        Issue
                      </Button>
                    )}
                  </>
                )}
              </ModalFooter>
            </>
          )}

          {/* Footer for split entities result */}
          {splitEntitiesResult.length > 0 && (
            <ModalFooter>
              <Button variant="primary" onClick={onClose}>
                Close
              </Button>
            </ModalFooter>
          )}
        </ModalContent>
      </Modal>

      {/* Sub-modals for batch splitting */}
      {convertDisclosure.isOpen && (
        <ConvertSplitModal
          trackedEntity={trackedEntity}
          itemType={material?.itemType ?? "Part"}
          onCancel={() => {
            convertDisclosure.onClose();
            setTrackedEntity(null);
          }}
          onSuccess={(convertedEntity) => {
            setSplitEntitiesResult((prev) =>
              prev.map((entity) =>
                entity.newId === convertedEntity.trackedEntityId
                  ? {
                      ...entity,
                      readableId: convertedEntity.readableId,
                      quantity: convertedEntity.quantity
                    }
                  : entity
              )
            );
            convertDisclosure.onClose();
            setTrackedEntity(null);
          }}
        />
      )}
      {scrapDisclosure.isOpen && (
        <ScrapSplitModal
          materialId={material?.id!}
          parentTrackedEntityId={parentId ?? ""}
          trackedEntity={trackedEntity}
          onCancel={() => {
            scrapDisclosure.onClose();
            setTrackedEntity(null);
          }}
          onSuccess={() => {
            scrapDisclosure.onClose();
            setTrackedEntity(null);
            onClose();
          }}
        />
      )}
    </>
  );
}

// Sub-modal for converting split batch entities
function ConvertSplitModal({
  trackedEntity,
  itemType,
  onCancel,
  onSuccess
}: {
  trackedEntity: string | null;
  itemType: string | null;
  onCancel: () => void;
  onSuccess: (convertedEntity: {
    trackedEntityId: string;
    readableId: string;
    quantity: number;
  }) => void;
}) {
  const fetcher = useFetcher<{
    success: boolean;
    message: string;
    convertedEntity?: {
      trackedEntityId: string;
      readableId: string;
      quantity: number;
    };
  }>();

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.convertedEntity) {
      toast.success("Entity converted successfully");
      onSuccess(fetcher.data.convertedEntity);
    } else if (fetcher.data?.success === false) {
      toast.error(fetcher.data.message || "Failed to convert entity");
    }
  }, [fetcher.data, onSuccess]);

  if (!trackedEntity) return null;

  return (
    <Modal open onOpenChange={onCancel}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            Convert to New {itemType === "Material" ? "Size" : "Revision"}
          </ModalTitle>
          <ModalDescription>
            Convert this tracked entity into a quantity of 1 of a new size.
          </ModalDescription>
        </ModalHeader>
        <ValidatedForm
          method="post"
          action={path.to.convertEntity(trackedEntity)}
          defaultValues={{
            trackedEntityId: trackedEntity,
            newRevision: "",
            quantity: 1
          }}
          validator={convertEntityValidator}
          fetcher={fetcher}
        >
          <Hidden name="trackedEntityId" />
          <ModalBody>
            <div className="flex flex-col gap-4">
              <FormInput
                name="newRevision"
                label={`New ${itemType === "Material" ? "Size" : "Revision"}`}
                autoFocus
              />
              <FormNumberInput
                name="quantity"
                label="Quantity"
                minValue={0.001}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
              type="submit"
              variant="primary"
            >
              Convert
            </Button>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

// Sub-modal for scrapping split batch entities
function ScrapSplitModal({
  materialId,
  parentTrackedEntityId,
  trackedEntity,
  onCancel,
  onSuccess
}: {
  materialId: string;
  parentTrackedEntityId: string;
  trackedEntity: string | null;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const fetcher = useFetcher<{ success: boolean; message: string }>();

  useEffect(() => {
    if (fetcher.data?.success) {
      onSuccess();
    }
  }, [fetcher.data?.success, onSuccess]);

  if (!trackedEntity) return null;

  return (
    <Modal open onOpenChange={onCancel}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Are you sure you want to scrap this batch?</ModalTitle>
          <ModalDescription>
            The remaining quantity will be removed from inventory and issued to
            the job
          </ModalDescription>
        </ModalHeader>
        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <fetcher.Form
            method="post"
            action={path.to.scrapEntity(
              materialId,
              trackedEntity,
              parentTrackedEntityId
            )}
          >
            <Button
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
              type="submit"
              variant="destructive"
            >
              Scrap
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// Hook for fetching serial numbers
function useSerialNumbers(itemId?: string) {
  const serialNumbersFetcher =
    useFetcher<Awaited<ReturnType<typeof getSerialNumbersForItem>>>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
  useEffect(() => {
    if (itemId) {
      serialNumbersFetcher.load(path.to.api.serialNumbers(itemId));
    }
  }, [itemId]);

  return { data: serialNumbersFetcher.data };
}

// Hook for fetching batch numbers
function useBatchNumbers(itemId?: string) {
  const batchNumbersFetcher =
    useFetcher<Awaited<ReturnType<typeof getBatchNumbersForItem>>>();

  useEffect(() => {
    if (itemId) {
      batchNumbersFetcher.load(path.to.api.batchNumbers(itemId));
    }
  }, [itemId, batchNumbersFetcher.load]);

  return { data: batchNumbersFetcher.data };
}

// Hook for fetching material stock pieces with dimensions
function useMaterialStock(materialId?: string) {
  const [data, setData] = useState<MaterialStockPiece[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { carbon } = useCarbon();

  const refresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!materialId || !carbon) {
      setData(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const fetchStock = async () => {
      const result = await getAvailableMaterialStock(carbon, materialId);

      if (!cancelled) {
        console.log("Setting stock data:", result.length, "pieces");
        setData(result);
        setIsLoading(false);
      }
    };

    fetchStock();

    return () => {
      cancelled = true;
    };
  }, [materialId, carbon, refreshKey]);

  return { data, isLoading, refresh };
}
