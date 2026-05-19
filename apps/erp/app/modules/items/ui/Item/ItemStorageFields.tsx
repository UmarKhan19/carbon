import { Combobox, FormControl, FormLabel } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useLocations } from "~/components/Form/Location";
import { StorageUnitDrillSelectField } from "~/components/Form/StorageUnitDrillSelect";
import { useUser } from "~/hooks";

const ItemStorageFields = () => {
  const { t } = useLingui();
  const { defaults } = useUser();
  const locations = useLocations();
  const [locationId, setLocationId] = useState(defaults.locationId ?? "");

  return (
    <>
      <FormControl>
        <FormLabel>{t`Location`}</FormLabel>
        <Combobox
          value={locationId}
          options={locations}
          onChange={setLocationId}
          placeholder={t`Select location`}
          isClearable
        />
      </FormControl>

      {locationId && (
        <StorageUnitDrillSelectField
          key={locationId}
          name="defaultStorageUnitId"
          label={t`Default Storage Unit`}
          locationId={locationId}
        />
      )}
    </>
  );
};

export default ItemStorageFields;
