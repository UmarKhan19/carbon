import type { Range } from "@tiptap/core";
import { atom } from "jotai";

export const queryAtom = atom("");
export const rangeAtom = atom(null as Range | null);
