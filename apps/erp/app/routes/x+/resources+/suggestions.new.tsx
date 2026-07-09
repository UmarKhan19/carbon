import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { ERP_URL } from "@carbon/env";
import { validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { ActionFunctionArgs } from "react-router";
import { getCompany, getSuggestionSlackChannel } from "~/modules/settings";
import { suggestionValidator } from "~/modules/shared";

const logger = getLogger("erp", "suggestions-new");

export async function action({ request }: ActionFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(suggestionValidator).validate(formData);

  if (validation.error) {
    return {
      success: false,
      message: "Failed to submit suggestion"
    };
  }

  const {
    attachmentPath,
    emoji,
    suggestion,
    path,
    userId: formUserId
  } = validation.data;
  const serviceRole = await getCarbonServiceRole();

  const insertSuggestion = await serviceRole
    .from("suggestion")
    .insert([
      {
        suggestion,
        emoji,
        path,
        attachmentPath: attachmentPath || null,
        userId: formUserId || null,
        companyId
      }
    ])
    .select("id")
    .single();

  if (insertSuggestion.error) {
    return {
      success: false,
      message: "Failed to submit suggestion"
    };
  }

  const company = await getCompany(serviceRole, companyId);

  if (!company.error && company.data?.suggestionNotificationGroup?.length) {
    try {
      await trigger("notify", {
        companyId,
        documentId: insertSuggestion.data.id,
        event: NotificationEvent.SuggestionResponse,
        recipient: {
          type: "group",
          groupIds: company.data.suggestionNotificationGroup
        },
        from: formUserId || userId
      });
    } catch (err) {
      logger.error("Failed to trigger suggestion notification", { error: err });
    }
  }

  await postSuggestionToSlack(serviceRole, {
    companyId,
    emoji,
    suggestion,
    suggestionId: insertSuggestion.data.id,
    userId: formUserId
  });

  return { success: true, message: "Suggestion submitted" };
}

// Post a new suggestion to the company's configured Slack channel. Independent
// of the in-app notification group so it fires for every submission (including
// anonymous). Silent no-op when no channel is configured; failures are logged
// but never fail the submission, which is already persisted.
async function postSuggestionToSlack(
  serviceRole: ReturnType<typeof getCarbonServiceRole>,
  {
    companyId,
    emoji,
    suggestion,
    suggestionId,
    userId
  }: {
    companyId: string;
    emoji: string;
    suggestion: string;
    suggestionId: string;
    userId: string | null | undefined;
  }
) {
  try {
    const channel = await getSuggestionSlackChannel(serviceRole, companyId);
    if (!channel) return;

    let submittedBy = "Anonymous";
    if (userId) {
      const submitter = await serviceRole
        .from("user")
        .select("fullName")
        .eq("id", userId)
        .single();
      submittedBy = submitter.data?.fullName || "Anonymous";
    }

    const url = `${ERP_URL}/x/resources/suggestions/${suggestionId}`;
    await trigger("send-slack", {
      companyId,
      channel,
      text: `${emoji} New suggestion from ${submittedBy}\n\n${suggestion}\n\n<${url}|View suggestion>`
    });
  } catch (err) {
    logger.error("Failed to post suggestion to Slack channel", { error: err });
  }
}
