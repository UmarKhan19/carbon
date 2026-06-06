import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import { Button } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form, redirect, useLoaderData } from "react-router";
import { z } from "zod";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const [companies] = await Promise.all([
    client.from("userToCompany").select("companyId").eq("userId", userId)
  ]);

  if (!companies.data) {
    throw new Error("Failed to load companies for user");
  }

  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const responseType = url.searchParams.get("response_type");
  const state = url.searchParams.get("state");
  const scope = url.searchParams.get("scope");
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = url.searchParams.get("code_challenge_method");

  // Validate client exists (static or dynamic)
  let clientName = "Unknown Application";
  if (clientId) {
    const serviceRole = getCarbonServiceRole();
    const [staticClient, dynamicClient] = await Promise.all([
      serviceRole.from("oauthClient").select("name").eq("clientId", clientId).single(),
      serviceRole.from("oauthDynamicClient").select("clientName").eq("clientId", clientId).single()
    ]);
    if (staticClient.data) {
      clientName = staticClient.data.name;
    } else if (dynamicClient.data) {
      clientName = dynamicClient.data.clientName;
    }
  }

  return {
    companyId,
    companies,
    clientId,
    clientName,
    redirectUri,
    responseType,
    state,
    scope,
    codeChallenge,
    codeChallengeMethod
  };
}

const authorizeValidator = z.object({
  client_id: z.string(),
  redirect_uri: z.string().url(),
  response_type: z.literal("code"),
  state: z.string().optional(),
  scope: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.enum(["S256", "plain"]).optional()
});

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "settings"
  });

  const validation = await validator(authorizeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return data({ error: "Invalid request" }, { status: 400 });
  }

  const {
    client_id,
    redirect_uri,
    state,
    scope,
    code_challenge,
    code_challenge_method
  } = validation.data;

  const serviceRole = getCarbonServiceRole();

  // Check static clients first, then dynamic clients
  const [staticClient, dynamicClient] = await Promise.all([
    serviceRole.from("oauthClient").select("*").eq("clientId", client_id).single(),
    serviceRole.from("oauthDynamicClient").select("*").eq("clientId", client_id).single()
  ]);

  const oauthClient = staticClient.data || dynamicClient.data;

  if (!oauthClient) {
    return data({ error: "Invalid client" }, { status: 400 });
  }

  // Verify redirect URI
  if (!oauthClient.redirectUris.includes(redirect_uri)) {
    return data({ error: "Invalid redirect URI" }, { status: 400 });
  }

  // For public clients (dynamic clients with token_endpoint_auth_method: none), PKCE is required
  const isDynamicClient = !!dynamicClient.data;
  const isPublicClient = isDynamicClient && dynamicClient.data.tokenEndpointAuthMethod === "none";

  if (isPublicClient && !code_challenge) {
    return data({ error: "PKCE required for public clients" }, { status: 400 });
  }

  // Generate and store authorization code
  const code = crypto.randomUUID();
  const codeResult = await serviceRole.from("oauthCode").insert([
    {
      code,
      clientId: client_id,
      userId,
      companyId,
      redirectUri: redirect_uri,
      scope: scope || null,
      codeChallenge: code_challenge || null,
      codeChallengeMethod: code_challenge_method || null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    }
  ]);

  if (codeResult.error) {
    return data(
      { error: "Failed to create authorization code" },
      { status: 500 }
    );
  }

  // Redirect to the client's redirect URI with the code and state
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.append("code", code);
  if (state) {
    redirectUrl.searchParams.append("state", state);
  }

  return redirect(redirectUrl.toString());
}

export default function AuthorizeRoute() {
  const {
    clientId,
    clientName,
    redirectUri,
    responseType,
    state,
    scope,
    codeChallenge,
    codeChallengeMethod
  } = useLoaderData<typeof loader>();

  return (
    <div className="max-w-md mx-auto mt-8">
      <h2 className="text-2xl font-bold mb-4">Authorize Application</h2>
      <p className="mb-4">
        <strong>{clientName}</strong> is requesting access to your Carbon account.
      </p>
      {scope && (
        <p className="mb-4 text-sm text-muted-foreground">
          Requested scope: {scope}
        </p>
      )}
      <Form method="post">
        <input type="hidden" name="client_id" value={clientId || ""} />
        <input type="hidden" name="redirect_uri" value={redirectUri || ""} />
        <input type="hidden" name="response_type" value={responseType || ""} />
        {state && <input type="hidden" name="state" value={state} />}
        {scope && <input type="hidden" name="scope" value={scope} />}
        {codeChallenge && (
          <input type="hidden" name="code_challenge" value={codeChallenge} />
        )}
        {codeChallengeMethod && (
          <input type="hidden" name="code_challenge_method" value={codeChallengeMethod} />
        )}
        <Button>Authorize</Button>
      </Form>
    </div>
  );
}
