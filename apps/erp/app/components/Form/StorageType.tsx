import type { ComboboxProps } from "@carbon/form";
import { CreatableCombobox } from "@carbon/form";
import { useDisclosure } from "@carbon/react";
import { useRef, useState } from "react";
import { StorageTypeForm } from "~/modules/items/ui/Item";
import { Enumerable } from "../Enumerable";

type StorageTypeSelectProps = Omit<ComboboxProps, "options"> & {
  options: { value: string; label: string }[];
  onNewOption?: (id: string) => void;
};

const StorageType = ({
  options,
  onNewOption,
  ...props
}: StorageTypeSelectProps) => {
  const newModal = useDisclosure();
  const [created, setCreated] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <CreatableCombobox
        ref={triggerRef}
        options={options.map((e) => ({
          value: e.value,
          label: <Enumerable value={e.label} key={e.label} />
        }))}
        {...props}
        label={props.label ?? "Storage Type"}
        onCreateOption={(option) => {
          setCreated(option);
          newModal.onOpen();
        }}
      />

      {newModal.isOpen && (
        <StorageTypeForm
          type="modal"
          initialValues={{ name: created }}
          onClose={() => {
            setCreated("");
            newModal.onClose();
            triggerRef.current?.click();
          }}
        />
      )}
    </>
  );
};

export default StorageType;
