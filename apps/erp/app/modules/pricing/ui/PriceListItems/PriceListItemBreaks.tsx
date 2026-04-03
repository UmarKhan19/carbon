import { useCarbon } from "@carbon/auth";
import { IconButton, Table, Tbody, Td, Th, Thead, Tr } from "@carbon/react";
import { useCallback, useState } from "react";
import { LuCirclePlus, LuTrash } from "react-icons/lu";
import { useCurrencyFormatter, useUser } from "~/hooks";

type Break = {
  priceListItemId: string;
  minQuantity: number;
  unitPrice: number;
  companyId?: string;
  createdBy?: string;
};

type PriceListItemBreaksProps = {
  priceListItemId: string;
  initialBreaks: Break[];
};

const PriceListItemBreaks = ({
  priceListItemId,
  initialBreaks
}: PriceListItemBreaksProps) => {
  const { carbon } = useCarbon();
  const { id: userId, company } = useUser();
  const formatter = useCurrencyFormatter();
  const [breaks, setBreaks] = useState<Break[]>(
    [...initialBreaks].sort((a, b) => a.minQuantity - b.minQuantity)
  );
  const [newQty, setNewQty] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const saveBreaks = useCallback(
    async (updatedBreaks: Break[]) => {
      if (!carbon || !company?.id) return;
      setSaving(true);
      try {
        // Delete all existing, then insert all
        await carbon
          .from("priceListItemBreak")
          .delete()
          .eq("priceListItemId", priceListItemId);

        if (updatedBreaks.length > 0) {
          await carbon.from("priceListItemBreak").insert(
            updatedBreaks.map((b) => ({
              priceListItemId,
              minQuantity: b.minQuantity,
              unitPrice: b.unitPrice,
              companyId: company.id,
              createdBy: userId
            }))
          );
        }
        setBreaks(updatedBreaks);
      } finally {
        setSaving(false);
      }
    },
    [carbon, company?.id, userId, priceListItemId]
  );

  const addBreak = useCallback(() => {
    const qty = Number.parseFloat(newQty);
    const price = Number.parseFloat(newPrice);
    if (Number.isNaN(qty) || Number.isNaN(price) || qty < 0 || price < 0)
      return;

    const updated = [
      ...breaks,
      { priceListItemId, minQuantity: qty, unitPrice: price }
    ].sort((a, b) => a.minQuantity - b.minQuantity);
    saveBreaks(updated);
    setNewQty("");
    setNewPrice("");
  }, [breaks, newQty, newPrice, priceListItemId, saveBreaks]);

  const removeBreak = useCallback(
    (index: number) => {
      const updated = breaks.filter((_, i) => i !== index);
      saveBreaks(updated);
    },
    [breaks, saveBreaks]
  );

  return (
    <div className="px-6 py-3">
      <p className="text-xs font-medium text-muted-foreground mb-2">
        Quantity Breaks
      </p>
      <Table className="w-auto">
        <Thead>
          <Tr className="h-8">
            <Th className="text-xs px-3 py-1 w-[120px]">Min Qty</Th>
            <Th className="text-xs px-3 py-1 w-[120px]">Unit Price</Th>
            <Th className="text-xs px-3 py-1 w-[40px]" />
          </Tr>
        </Thead>
        <Tbody>
          {breaks.map((b, i) => (
            <Tr key={`${b.minQuantity}-${b.unitPrice}`} className="h-8">
              <Td className="px-3 py-1 text-sm">{b.minQuantity}</Td>
              <Td className="px-3 py-1 text-sm">
                {formatter.format(b.unitPrice)}
              </Td>
              <Td className="px-1 py-1">
                <IconButton
                  aria-label="Remove break"
                  icon={<LuTrash />}
                  size="sm"
                  variant="ghost"
                  onClick={() => removeBreak(i)}
                />
              </Td>
            </Tr>
          ))}
          <Tr className="h-8">
            <Td className="px-3 py-1">
              <input
                type="number"
                placeholder="Qty"
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
                className="w-full bg-transparent border border-border rounded px-2 py-0.5 text-sm"
                min={0}
              />
            </Td>
            <Td className="px-3 py-1">
              <input
                type="number"
                placeholder="Price"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                className="w-full bg-transparent border border-border rounded px-2 py-0.5 text-sm"
                min={0}
                step={0.01}
              />
            </Td>
            <Td className="px-1 py-1">
              <IconButton
                aria-label="Add break"
                icon={<LuCirclePlus />}
                size="sm"
                variant="ghost"
                onClick={addBreak}
                isDisabled={saving || !newQty || !newPrice}
              />
            </Td>
          </Tr>
        </Tbody>
      </Table>
      {breaks.length === 0 && (
        <p className="text-xs text-muted-foreground mt-1">
          No quantity breaks. Add tiers for volume pricing.
        </p>
      )}
    </div>
  );
};

export default PriceListItemBreaks;
