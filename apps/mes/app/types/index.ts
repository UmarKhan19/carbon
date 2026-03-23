export type ListItem = {
  id: string;
  name: string;
};

export type PinnedInUser = {
  userId: string;
  name: string;
  avatarUrl: string | null;
};

export type UserContext = {
  locationId: string;
  companyId: string;
  consoleMode: boolean;
  effectiveUserId: string;
  pinnedInUser: PinnedInUser | null;
};
