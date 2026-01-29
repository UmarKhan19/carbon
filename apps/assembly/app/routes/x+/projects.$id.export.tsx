import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Button,
  Card,
  Heading,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text
} from "@carbon/react";
import { useState } from "react";
import {
  BsArrowLeft,
  BsClipboard,
  BsDownload,
  BsEnvelope,
  BsFilePdf,
  BsLink45Deg,
  BsPhone,
  BsPlayCircle,
  BsQrCode,
  BsShare
} from "react-icons/bs";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  Link,
  redirect,
  useLoaderData,
  useNavigation
} from "react-router";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "assembly"
  });

  const projectId = params.id;
  if (!projectId) {
    throw new Response("Project not found", { status: 404 });
  }

  const { data: project, error: projectError } = await client
    .from("assemblyProject")
    .select("*")
    .eq("id", projectId)
    .eq("companyId", companyId)
    .single();

  if (projectError || !project) {
    throw new Response("Project not found", { status: 404 });
  }

  // Get existing share links
  const { data: shareLinks } = await client
    .from("assemblyShareLink")
    .select("*")
    .eq("projectId", projectId)
    .order("createdAt", { ascending: false });

  return {
    project,
    shareLinks: shareLinks ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const {
    client,
    companyId: _companyId,
    userId
  } = await requirePermissions(request, {
    update: "assembly"
  });

  const projectId = params.id;
  if (!projectId) {
    throw new Response("Project not found", { status: 404 });
  }

  const formData = await request.formData();
  const action = formData.get("_action");

  if (action === "createShareLink") {
    const allowDownload = formData.get("allowDownload") === "true";
    const expiresInDays = parseInt(formData.get("expiresInDays") as string, 10);
    const password = formData.get("password") as string;

    const token = crypto.randomUUID();
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const { error: createError } = await client
      .from("assemblyShareLink")
      .insert({
        projectId,
        token,
        expiresAt,
        password: password || null,
        allowDownload,
        createdBy: userId
      });

    if (createError) {
      return redirect(
        path.to.projectExport(projectId),
        await flash(request, error(createError, "Failed to create share link"))
      );
    }

    return redirect(
      path.to.projectExport(projectId),
      await flash(request, success("Share link created!"))
    );
  }

  if (action === "exportVideo") {
    const _resolution = formData.get("resolution") as string;
    const _fps = parseInt(formData.get("fps") as string, 10);

    // TODO: Trigger video export job via Trigger.dev

    return redirect(
      path.to.projectExport(projectId),
      await flash(
        request,
        success(
          "Video export started! You'll receive an email when it's ready."
        )
      )
    );
  }

  if (action === "exportPdf") {
    // TODO: Generate PDF

    return redirect(
      path.to.projectExport(projectId),
      await flash(request, success("PDF export started!"))
    );
  }

  return null;
}

export default function ProjectExportRoute() {
  const { project, shareLinks } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [showShareLinkForm, setShowShareLinkForm] = useState(false);

  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://assembly.carbon.ms";

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <Heading size="h2">Export & Share</Heading>
          <p className="text-muted-foreground mt-1">{project.name}</p>
        </div>
        <Button variant="outline" asChild>
          <Link to={path.to.project(project.id)}>
            <BsArrowLeft className="w-4 h-4 mr-2" />
            Back to Project
          </Link>
        </Button>
      </div>

      {/* Video Export */}
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-primary/10 rounded-lg">
            <BsPlayCircle className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1">
            <Heading size="h4">Video Export</Heading>
            <p className="text-muted-foreground mt-1">
              Generate a video of the full assembly sequence with all animations
              and annotations.
            </p>

            <Form method="post" className="mt-4 space-y-4">
              <input type="hidden" name="_action" value="exportVideo" />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Resolution</Label>
                  <Select name="resolution" defaultValue="1080p">
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="720p">720p (HD)</SelectItem>
                      <SelectItem value="1080p">1080p (Full HD)</SelectItem>
                      <SelectItem value="4k">4K (Ultra HD)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Frame Rate</Label>
                  <Select name="fps" defaultValue="30">
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24">24 fps</SelectItem>
                      <SelectItem value="30">30 fps</SelectItem>
                      <SelectItem value="60">60 fps</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button type="submit" disabled={isSubmitting}>
                <BsDownload className="w-4 h-4 mr-2" />
                Export Video
              </Button>
            </Form>
          </div>
        </div>
      </Card>

      {/* PDF Export */}
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-red-500/10 rounded-lg">
            <BsFilePdf className="w-6 h-6 text-red-500" />
          </div>
          <div className="flex-1">
            <Heading size="h4">PDF Work Instructions</Heading>
            <p className="text-muted-foreground mt-1">
              Generate a printable PDF document with step-by-step instructions
              and images.
            </p>

            <Form method="post" className="mt-4">
              <input type="hidden" name="_action" value="exportPdf" />
              <Button type="submit" variant="outline" disabled={isSubmitting}>
                <BsDownload className="w-4 h-4 mr-2" />
                Download PDF
              </Button>
            </Form>
          </div>
        </div>
      </Card>

      {/* Share Links */}
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-green-500/10 rounded-lg">
            <BsShare className="w-6 h-6 text-green-500" />
          </div>
          <div className="flex-1">
            <Heading size="h4">Share Links</Heading>
            <p className="text-muted-foreground mt-1">
              Create shareable links for operators to view instructions on any
              device.
            </p>

            {/* Existing Links */}
            {shareLinks.length > 0 && (
              <div className="mt-4 space-y-2">
                {shareLinks.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center justify-between p-3 bg-muted rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <BsLink45Deg className="w-4 h-4 text-muted-foreground" />
                      <div>
                        <code className="text-sm">
                          {baseUrl}/share/{link.token.slice(0, 8)}...
                        </code>
                        <p className="text-xs text-muted-foreground">
                          {link.expiresAt
                            ? `Expires: ${new Date(link.expiresAt).toLocaleDateString()}`
                            : "No expiration"}
                          {link.password && " | Password protected"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            `${baseUrl}/share/${link.token}`
                          );
                        }}
                      >
                        <BsClipboard className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm">
                        <BsQrCode className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Create New Link Form */}
            {showShareLinkForm ? (
              <Form
                method="post"
                className="mt-4 p-4 border rounded-lg space-y-4"
              >
                <input type="hidden" name="_action" value="createShareLink" />

                <div>
                  <Label>Link Expiration</Label>
                  <Select name="expiresInDays" defaultValue="30">
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Never expires</SelectItem>
                      <SelectItem value="7">7 days</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                      <SelectItem value="90">90 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Password (optional)</Label>
                  <Input
                    name="password"
                    type="password"
                    placeholder="Leave empty for no password"
                    className="mt-1"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="allowDownload"
                    value="true"
                    id="allowDownload"
                  />
                  <Label
                    htmlFor="allowDownload"
                    className="text-sm font-normal"
                  >
                    Allow viewers to download video
                  </Label>
                </div>

                <div className="flex gap-2">
                  <Button type="submit" disabled={isSubmitting}>
                    Create Link
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowShareLinkForm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </Form>
            ) : (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setShowShareLinkForm(true)}
              >
                <BsLink45Deg className="w-4 h-4 mr-2" />
                Create New Share Link
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Mobile Access */}
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-purple-500/10 rounded-lg">
            <BsPhone className="w-6 h-6 text-purple-500" />
          </div>
          <div className="flex-1">
            <Heading size="h4">Mobile Access</Heading>
            <p className="text-muted-foreground mt-1">
              Operators can view instructions on mobile devices using share
              links. The viewer is optimized for touch screens and supports
              offline viewing.
            </p>
            <div className="mt-4 flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <BsQrCode className="w-4 h-4" />
                Scan QR code on printed labels
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <BsEnvelope className="w-4 h-4" />
                Email links to team members
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
