import { postInternalAlert } from "@carbon/lib/alerts.server";
import { type InngestClient, inngest } from "@carbon/lib/inngest";

export { type InngestClient, inngest };

type CreateFnArgs = Parameters<InngestClient["createFunction"]>;
type FnConfig = CreateFnArgs[0];
type FnTrigger = CreateFnArgs[1];
type FnHandler = CreateFnArgs[2];

/**
 * Wrapper around inngest.createFunction that posts to the internal alerts
 * Slack channel whenever a function exhausts its retries. Any caller-supplied
 * onFailure runs after the alert.
 */
export function defineFunction(
  config: FnConfig,
  trigger: FnTrigger,
  handler: FnHandler
) {
  const userOnFailure = (config as { onFailure?: (args: any) => unknown })
    .onFailure;

  return inngest.createFunction(
    {
      ...config,
      onFailure: async (args: any) => {
        await postInternalAlert({
          source: `inngest:${config.id}`,
          error: args?.error,
          context: {
            event: args?.event?.name,
            run_id: args?.event?.data?.run_id
          }
        });
        if (userOnFailure) await userOnFailure(args);
      }
    },
    trigger,
    handler
  );
}
