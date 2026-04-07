import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  createPrintJob,
  getPrinterRoutes,
  getPrintJob,
  getPrintJobContent,
  getPrintJobs,
  reprintValidator
} from "@carbon/printing";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  ScrollArea,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { tasks } from "@trigger.dev/sdk";
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { useRealtime } from "~/hooks";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Print Manager",
  to: path.to.printManager,
  module: "printing"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "printing"
  });

  const url = new URL(request.url);
  const status = url.searchParams.get("status") || undefined;
  const limit = 50;
  const offset = Number(url.searchParams.get("offset")) || 0;

  const [printJobs, printerRoutes] = await Promise.all([
    getPrintJobs(client, companyId, { status, limit, offset }),
    getPrinterRoutes(client, companyId)
  ]);

  return {
    printJobs: printJobs.data ?? [],
    count: printJobs.count ?? 0,
    printerRoutes: printerRoutes.data ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "printing"
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  switch (intent) {
    case "reprint": {
      const validation = reprintValidator.safeParse(
        Object.fromEntries(formData)
      );
      if (!validation.success)
        return data(
          { success: false, message: "Invalid reprint request" },
          await flash(request, error(null, "Invalid reprint request"))
        );

      const { printJobId, printerUrl: overrideUrl } = validation.data;

      // Fetch full job including content and source document info
      const original = await getPrintJobContent(client, printJobId, companyId);
      const originalMeta = await getPrintJob(client, printJobId, companyId);
      if (
        original.error ||
        !original.data ||
        originalMeta.error ||
        !originalMeta.data
      )
        return data(
          { success: false, message: "Failed to load print job" },
          await flash(
            request,
            error(
              original.error ?? originalMeta.error,
              "Failed to load print job"
            )
          )
        );

      if (!original.data.content || !original.data.contentType)
        return data(
          { success: false, message: "Cannot reprint a job with no content" },
          await flash(
            request,
            error(null, "Cannot reprint a job that is still generating")
          )
        );

      const newJob = await createPrintJob(client, {
        companyId,
        contentType: original.data.contentType as "zpl" | "pdf",
        content: original.data.content,
        printerUrl: overrideUrl || originalMeta.data.printerUrl,
        sourceDocument: originalMeta.data.sourceDocument,
        sourceDocumentId: originalMeta.data.sourceDocumentId,
        sourceDocumentReadableId:
          originalMeta.data.sourceDocumentReadableId ?? undefined,
        description: originalMeta.data.description,
        status: "queued",
        origin: "reprint",
        createdBy: userId
      });

      if (newJob.error || !newJob.data)
        return data(
          { success: false, message: "Failed to create reprint job" },
          await flash(request, error(newJob.error, "Failed to create reprint"))
        );

      try {
        await tasks.trigger("print-job-deliver", {
          printJobId: newJob.data.id,
          companyId
        });
      } catch (e) {
        console.error("Failed to trigger delivery:", e);
      }

      return data(
        { success: true, message: "Reprint job created" },
        await flash(request, success("Reprint job created"))
      );
    }

    case "delete": {
      const printJobId = formData.get("printJobId") as string;
      if (!printJobId)
        return data(
          { success: false, message: "Print job ID required" },
          await flash(request, error(null, "Print job ID required"))
        );

      const result = await client
        .from("printJob")
        .delete()
        .eq("id", printJobId)
        .eq("companyId", companyId);

      if (result.error)
        return data(
          { success: false, message: result.error.message },
          await flash(request, error(result.error, "Failed to delete job"))
        );

      return data(
        { success: true, message: "Print job deleted" },
        await flash(request, success("Print job deleted"))
      );
    }

    case "viewContent": {
      const printJobId = formData.get("printJobId") as string;
      if (!printJobId)
        return { success: false, message: "Print job ID required" };

      const content = await getPrintJobContent(client, printJobId, companyId);
      if (content.error || !content.data)
        return { success: false, message: "Failed to load content" };

      return {
        success: true,
        content: content.data.content,
        contentType: content.data.contentType,
        printJobId: content.data.id
      };
    }
  }

  return { success: false, message: "Unknown intent" };
}

const statusBadgeVariant: Record<
  string,
  "yellow" | "blue" | "green" | "red" | "purple"
> = {
  generating: "purple",
  queued: "yellow",
  printing: "blue",
  completed: "green",
  failed: "red"
};

export default function PrintManagerRoute() {
  const { printJobs, count } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewContent, setViewContent] = useState<{
    content: string;
    contentType: string;
    printJobId: string;
  } | null>(null);

  useRealtime("printJob");

  useEffect(() => {
    if (fetcher.data && "content" in fetcher.data && fetcher.data.content) {
      setViewContent({
        content: fetcher.data.content as string,
        contentType: fetcher.data.contentType as string,
        printJobId: fetcher.data.printJobId as string
      });
    }
  }, [fetcher.data]);

  const statusFilter = searchParams.get("status") || "";

  return (
    <VStack spacing={0} className="h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <Heading size="h3">Print Manager</Heading>
        <select
          className="h-8 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          value={statusFilter}
          onChange={(e) => {
            const params = new URLSearchParams(searchParams);
            if (e.target.value) {
              params.set("status", e.target.value);
            } else {
              params.delete("status");
            }
            setSearchParams(params);
          }}
        >
          <option value="">All statuses</option>
          <option value="generating">Generating</option>
          <option value="queued">Queued</option>
          <option value="printing">Printing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <ScrollArea className="w-full flex-1">
        <div className="px-2">
          <Table>
            <Thead>
              <Tr>
                <Th className="pl-6">Status</Th>
                <Th>Description</Th>
                <Th>Source</Th>
                <Th>Type</Th>
                <Th>Origin</Th>
                <Th>Created</Th>
                <Th className="pr-6 text-right">Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {printJobs.length === 0 && (
                <Tr>
                  <Td
                    colSpan={7}
                    className="text-center text-muted-foreground py-12"
                  >
                    No print jobs found
                  </Td>
                </Tr>
              )}
              {printJobs.map((job) => (
                <Tr key={job.id}>
                  <Td className="pl-6">
                    <Badge
                      variant={statusBadgeVariant[job.status] ?? "secondary"}
                    >
                      {job.status}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="max-w-[300px] truncate font-medium">
                      {job.description}
                    </div>
                    {job.error && (
                      <div className="text-xs text-destructive truncate max-w-[300px] mt-0.5">
                        {job.error}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <span className="text-muted-foreground">
                      {job.sourceDocument}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs uppercase text-muted-foreground">
                      {job.contentType ?? "—"}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-muted-foreground">{job.origin}</span>
                  </Td>
                  <Td>
                    <span className="text-muted-foreground whitespace-nowrap">
                      {new Date(job.createdAt).toLocaleString()}
                    </span>
                  </Td>
                  <Td className="pr-6">
                    <HStack className="justify-end gap-1">
                      <fetcher.Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value="viewContent"
                        />
                        <input type="hidden" name="printJobId" value={job.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          disabled={job.status === "generating"}
                        >
                          View
                        </Button>
                      </fetcher.Form>
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="reprint" />
                        <input type="hidden" name="printJobId" value={job.id} />
                        <input
                          type="hidden"
                          name="printerUrl"
                          value={job.printerUrl}
                        />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          disabled={job.status === "generating"}
                        >
                          Reprint
                        </Button>
                      </fetcher.Form>
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="printJobId" value={job.id} />
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                        >
                          Delete
                        </Button>
                      </fetcher.Form>
                    </HStack>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>

        {count > 50 && (
          <div className="flex justify-center py-4">
            <span className="text-sm text-muted-foreground">
              Showing {printJobs.length} of {count} jobs
            </span>
          </div>
        )}
      </ScrollArea>

      {viewContent && (
        <div className="border-t border-border w-full">
          <Card className="m-4 w-auto">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm font-medium">
                Print Output ({viewContent.contentType?.toUpperCase()})
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewContent(null)}
              >
                Close
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {viewContent.contentType === "zpl" ? (
                <ZplPreview zpl={viewContent.content} />
              ) : viewContent.contentType === "pdf" ? (
                <iframe
                  src={`data:application/pdf;base64,${viewContent.content}`}
                  className="w-full h-[40vh] border border-border rounded-md"
                  title="PDF Preview"
                />
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </VStack>
  );
}

function parseZplDimensions(zplContent: string) {
  const pwMatch = zplContent.match(/\^PW(\d+)/);
  const llMatch = zplContent.match(/\^LL(\d+)/);
  const dpi = 203;
  const dpmm = Math.round(dpi / 25.4);

  const widthInches = pwMatch
    ? Math.max(0.5, Math.round((Number(pwMatch[1]) / dpi) * 10) / 10)
    : 2;
  const heightInches = llMatch
    ? Math.max(0.5, Math.round((Number(llMatch[1]) / dpi) * 10) / 10)
    : 1;

  return { dpmm, width: widthInches, height: heightInches };
}

function ZplPreview({ zpl }: { zpl: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    const { dpmm, width, height } = parseZplDimensions(zpl);

    fetch(
      `https://api.labelary.com/v1/printers/${dpmm}dpmm/labels/${width}x${height}/0/`,
      {
        method: "POST",
        headers: {
          Accept: "image/png",
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: zpl
      }
    )
      .then((res) => {
        if (!res.ok) throw new Error(`Labelary returned ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
        setLoading(false);
      })
      .catch((err) => {
        if (revoked) return;
        setError(err.message);
        setLoading(false);
      });

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [zpl]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Rendering label preview...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-destructive">Preview failed: {error}</p>
        <pre className="text-xs font-mono bg-muted p-4 rounded-md overflow-auto whitespace-pre-wrap">
          {zpl}
        </pre>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <img
        src={imageUrl!}
        alt="ZPL Label Preview"
        className="border border-border rounded-md max-h-[350px] object-contain self-start"
      />
      <pre className="text-xs font-mono bg-muted p-4 rounded-md overflow-auto whitespace-pre-wrap">
        {zpl}
      </pre>
    </div>
  );
}
