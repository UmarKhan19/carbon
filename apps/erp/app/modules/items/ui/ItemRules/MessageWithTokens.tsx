import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack
} from "@carbon/react";
import { FIELD_REGISTRY } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useRef } from "react";
import { LuBraces } from "react-icons/lu";
import { TextArea } from "~/components/Form";

type MessageWithTokensProps = {
  name: string;
  label?: string;
};

export default function MessageWithTokens({
  name,
  label
}: MessageWithTokensProps) {
  const { t } = useLingui();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // The Carbon TextArea wraps a native textarea; reach for it via DOM after mount.
  const setRefFromDom = useCallback((el: HTMLDivElement | null) => {
    textareaRef.current = el?.querySelector("textarea") ?? null;
  }, []);

  const insertToken = useCallback((token: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const insertion = `{${token}}`;
    el.value = el.value.slice(0, start) + insertion + el.value.slice(end);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    const cursor = start + insertion.length;
    el.setSelectionRange(cursor, cursor);
    el.focus();
  }, []);

  return (
    <div className="w-full" ref={setRefFromDom}>
      <TextArea
        name={name}
        label={label ?? t`Message`}
        placeholder={t`Shown to the user when this rule fails. Use {item.name} or other tokens.`}
      />
      <HStack className="justify-end mt-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" leftIcon={<LuBraces />}>
              <Trans>Insert token</Trans>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {FIELD_REGISTRY.map((f) => (
              <DropdownMenuItem
                key={f.path}
                onClick={() => insertToken(f.path)}
              >
                <span className="font-mono text-xs">{`{${f.path}}`}</span>
                <span className="ml-2 text-muted-foreground text-xs">
                  {f.label}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </HStack>
    </div>
  );
}
