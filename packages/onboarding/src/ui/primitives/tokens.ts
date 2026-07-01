// Canonical visual tokens for owners and statuses. Single source so a colour or
// label change lands everywhere at once (previously these maps were re-declared
// in RolesView, BoardTable, etc.). Adding an owner/status = one entry here.

import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { Owner, TaskValue } from "../../types";

export interface OwnerToken {
  label: MessageDescriptor;
  // pill background + text
  cls: string;
  // accompanying dot
  dot: string;
}

export const OWNER_TOKENS: Record<Owner, OwnerToken> = {
  carbon: {
    label: msg`Carbon`,
    cls: "bg-status-blue/12 text-status-blue-fg",
    dot: "bg-status-blue"
  },
  you: {
    label: msg`You`,
    cls: "bg-status-green/12 text-status-green-fg",
    dot: "bg-status-green"
  },
  shared: {
    label: msg`Shared`,
    cls: "border text-muted-foreground",
    dot: "bg-muted-foreground"
  }
};

export interface StatusToken {
  label: MessageDescriptor;
  cls: string;
  dot: string;
}

export const TASK_STATUS_TOKENS: Record<TaskValue, StatusToken> = {
  todo: {
    label: msg`Not started`,
    dot: "bg-muted-foreground/50",
    cls: "border text-muted-foreground"
  },
  prog: {
    label: msg`In progress`,
    dot: "bg-status-blue",
    cls: "bg-status-blue/12 text-status-blue-fg"
  },
  blocked: {
    label: msg`Blocked`,
    dot: "bg-status-red",
    cls: "bg-status-red/12 text-status-red-fg"
  },
  done: {
    label: msg`Done`,
    dot: "bg-status-green",
    cls: "bg-status-green/12 text-status-green-fg"
  }
};
