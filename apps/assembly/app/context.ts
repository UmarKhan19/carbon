import { createContext } from "react";

export const AssemblyContext = createContext<{
  projectId?: string;
}>({});
