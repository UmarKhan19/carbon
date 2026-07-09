import type { ComboboxProps } from "@carbon/form";
import { Combobox } from "@carbon/form";
import { useMount } from "@carbon/react";
import { useMemo } from "react";
import { useFetcher } from "react-router";
import type { getResourceCalendarsList } from "~/modules/resources";
import { path } from "~/utils/path";

type ResourceCalendarSelectProps = Omit<ComboboxProps, "options">;

const ResourceCalendar = (props: ResourceCalendarSelectProps) => {
  const options = useResourceCalendars();

  return (
    <Combobox options={options} {...props} label={props?.label ?? "Calendar"} />
  );
};

ResourceCalendar.displayName = "ResourceCalendar";

export default ResourceCalendar;

export const useResourceCalendars = () => {
  const calendarFetcher =
    useFetcher<Awaited<ReturnType<typeof getResourceCalendarsList>>>();

  useMount(() => {
    calendarFetcher.load(path.to.api.resourceCalendars);
  });

  const options = useMemo(
    () =>
      calendarFetcher.data?.data
        ? calendarFetcher.data?.data.map((c) => ({
            value: c.id,
            label: c.name
          }))
        : [],
    [calendarFetcher.data]
  );

  return options;
};
