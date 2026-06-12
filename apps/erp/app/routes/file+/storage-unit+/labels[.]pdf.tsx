import { requirePermissions } from "@carbon/auth/auth.server";
import { labelSizes } from "@carbon/utils";
import {
  Document,
  Page,
  renderToStream,
  Text,
  View
} from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory"
  });

  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");

  if (!idsParam) {
    return new Response("No storage unit IDs provided", { status: 400 });
  }

  const ids = idsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return new Response("No valid storage unit IDs provided", { status: 400 });
  }

  const labelSizeId = url.searchParams.get("labelSize") ?? "avery5163";
  const labelSize = labelSizes.find((s) => s.id === labelSizeId);

  if (!labelSize) {
    return new Response(`Invalid label size: ${labelSizeId}`, { status: 400 });
  }

  const { data: units, error } = await client
    .from("storageUnit")
    .select("id, name")
    .in("id", ids);

  if (error || !units?.length) {
    return new Response("No storage units found", { status: 404 });
  }

  const columns = labelSize.columns ?? 3;
  const rows = labelSize.rows ?? 10;
  const labelsPerPage = columns * rows;

  const pages: (typeof units)[] = [];
  for (let i = 0; i < units.length; i += labelsPerPage) {
    pages.push(units.slice(i, i + labelsPerPage));
  }

  const stream = await renderToStream(
    <Document>
      {pages.map((pageItems, pageIndex) => {
        const pageRows: (typeof units)[] = [];
        for (let i = 0; i < pageItems.length; i += columns) {
          pageRows.push(pageItems.slice(i, i + columns));
        }

        return (
          <Page
            key={pageIndex}
            size="LETTER"
            style={{ padding: "36 18", flexDirection: "column" }}
          >
            {pageRows.map((row, rowIndex) => (
              <View
                key={rowIndex}
                style={{
                  flexDirection: "row",
                  height: `${labelSize.height * 72}px`
                }}
              >
                {row.map((item) => (
                  <View
                    key={item.id}
                    style={{
                      width: `${labelSize.width * 72}px`,
                      height: `${labelSize.height * 72}px`,
                      justifyContent: "center",
                      padding: "4 8"
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: 700 }}>
                      {item.name}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </Page>
        );
      })}
    </Document>
  );

  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data: Uint8Array) => {
      buffers.push(data);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(buffers));
    });
    stream.on("error", reject);
  });

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="storage-unit-labels.pdf"`
    }
  });
}
