import type { ButtonProps } from "@carbon/react";
import {
  Button,
  HStack,
  Kbd,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useKeyboardShortcuts
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useRef } from "react";
import { LuCirclePlus } from "react-icons/lu";
import { Link } from "react-router";

type NewProps = {
  label?: string;
  to: string;
  variant?: ButtonProps["variant"];
};

const New = ({ label, to, variant = "primary" }: NewProps) => {
  const { _: t } = useLingui();
  const { _: tSales } = useLingui();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const translatedLabel = label
    ? (() => {
        const fromSales = tSales(label);
        if (fromSales !== label) return fromSales;
        return t(label);
      })()
    : undefined;
  useKeyboardShortcuts({
    n: (event: KeyboardEvent) => {
      event.stopPropagation();
      buttonRef.current?.click();
    }
  });

  return (
    <Tooltip>
      <TooltipTrigger>
        <Button
          asChild
          leftIcon={<LuCirclePlus />}
          variant={variant}
          ref={buttonRef}
        >
          <Link to={to} prefetch="intent">
            {translatedLabel
              ? `${t(msg({ id: "Add", message: "Add" }))} ${translatedLabel}`
              : t(msg({ id: "Add", message: "Add" }))}
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <HStack>
          <Kbd>N</Kbd>
        </HStack>
      </TooltipContent>
    </Tooltip>
  );
};

export default New;
