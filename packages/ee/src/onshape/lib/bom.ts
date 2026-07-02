// Flatten an Onshape multi-level BOM response (headers + rows) into an array of
// header-name → value dicts. Single source of truth for parsing the Onshape BOM
// shape — shared by the browse route (per-line sync) and the released-revision
// import. Returns [] when the response lacks the expected structure.
export function flattenOnshapeBomRows(
  response: unknown
): Record<string, any>[] {
  if (
    !response ||
    typeof response !== "object" ||
    !("headers" in response) ||
    !Array.isArray((response as { headers: unknown }).headers) ||
    !("rows" in response) ||
    !Array.isArray((response as { rows: unknown }).rows)
  ) {
    return [];
  }

  const headers = (response as { headers: { id: string; name: string }[] })
    .headers;
  const rows = (
    response as { rows: { headerIdToValue: Record<string, any> }[] }
  ).rows;

  return rows.map((row) => {
    const data: Record<string, any> = {};
    headers.forEach((header) => {
      if (header.name === "Material") {
        // Material may be an object carrying a displayName.
        data[header.name] = row.headerIdToValue[header.id]?.displayName || "";
      } else {
        data[header.name] = row.headerIdToValue[header.id] || "";
      }
    });
    return data;
  });
}
