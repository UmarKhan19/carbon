import { useChatActions } from "@ai-sdk-tools/store";
import { IconButton } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { LuArrowLeft } from "react-icons/lu";
import { useNavigate } from "react-router";
import { path } from "~/utils/path";
import { useChatInterface } from "./hooks/useChatInterface";

export function ChatNavigation() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const { reset } = useChatActions();
  const { isChatPage } = useChatInterface();

  const handleBack = () => {
    reset();
    navigate(path.to.authenticatedRoot);
  };

  if (!isChatPage) return null;

  return (
    <div className="absolute left-0">
      <IconButton
        aria-label={t`Back to home`}
        variant="ghost"
        onClick={handleBack}
        icon={<LuArrowLeft />}
      />
    </div>
  );
}
