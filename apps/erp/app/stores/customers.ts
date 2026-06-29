import { atom } from "nanostores";
import { useNanoStore } from "~/hooks";
import type { ListItem } from "~/types";

const $customersStore = atom<
  (Omit<ListItem, "readableId"> & {
    website?: string | null;
    readableId?: string | null;
    customerStatusId?: string | null;
  })[]
>([]);
export const useCustomers = () => useNanoStore($customersStore, "customers");

// The id of the built-in "Inactive" customer status, resolved once app-wide by
// RealtimeDataProvider. The customer store only carries the status FK
// (`customerStatusId`), so this lets selects and display chips tell whether a
// customer is inactive without each instance fetching the status list.
const $inactiveCustomerStatusId = atom<string | null>(null);
export const useInactiveCustomerStatusId = () =>
  useNanoStore($inactiveCustomerStatusId, "inactiveCustomerStatusId");
