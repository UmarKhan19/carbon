import { error, magicLinkValidator } from "@carbon/auth";
import { sendMagicLink, verifyAuthSession } from "@carbon/auth/auth.server";
import { flash, getAuthSession } from "@carbon/auth/session.server";
import { Input, Submit, ValidatedForm, validator } from "@carbon/form";
import { Button, Heading, VStack } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useFetcher } from "react-router";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await getAuthSession(request);
  if (authSession && (await verifyAuthSession(authSession))) {
    throw redirect(path.to.authenticatedRoot);
  }
  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  const validation = await validator(magicLinkValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return data(
      error(validation.error, "Invalid email address"),
      await flash(request, error(null, "Invalid email address"))
    );
  }

  const { email } = validation.data;

  const result = await sendMagicLink(email);
  if (result.error) {
    return data(
      error(result.error, "Failed to send magic link"),
      await flash(request, error(null, result.error.message))
    );
  }

  return data(
    { success: true, message: "Check your email for a login link" },
    await flash(request, { message: "Check your email for a login link" })
  );
}

export default function LoginRoute() {
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state === "submitting";
  const success = fetcher.data && "success" in fetcher.data;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-8 p-8">
        <div className="text-center">
          <img
            src="/carbon-logo-mark.svg"
            alt="Carbon Assembly"
            className="mx-auto h-12 w-12"
          />
          <Heading size="h2" className="mt-6">
            Carbon Assembly
          </Heading>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to create assembly instructions
          </p>
        </div>

        {success ? (
          <div className="rounded-lg bg-green-50 p-4 text-center dark:bg-green-900/20">
            <p className="text-green-700 dark:text-green-300">
              Check your email for a login link
            </p>
          </div>
        ) : (
          <ValidatedForm
            fetcher={fetcher}
            validator={validator(magicLinkValidator)}
            method="post"
            className="mt-8 space-y-6"
          >
            <VStack spacing={4}>
              <Input
                name="email"
                type="email"
                label="Email address"
                placeholder="you@company.com"
                autoComplete="email"
                required
              />
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Sending..." : "Send Magic Link"}
              </Button>
            </VStack>
          </ValidatedForm>
        )}
      </div>
    </div>
  );
}
