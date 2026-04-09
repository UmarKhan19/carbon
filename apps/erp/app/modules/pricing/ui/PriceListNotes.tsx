import { useCarbon } from "@carbon/auth";
import type { JSONContent } from "@carbon/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  generateHTML,
  toast,
  useDebounce
} from "@carbon/react";
import { Editor } from "@carbon/react/Editor";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useState } from "react";
import { useParams } from "react-router";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import type { PriceListDetail } from "../types";

export function PriceListNotes() {
  const { id } = useParams();
  const { carbon } = useCarbon();
  const { id: userId } = useUser();
  const permissions = usePermissions();

  const routeData = useRouteData<{ priceList: PriceListDetail }>(
    path.to.priceList(id!)
  );
  const priceList = routeData?.priceList;

  const [notes, setNotes] = useState<JSONContent>(
    (priceList as any)?.notes ?? {}
  );

  const onSave = useDebounce(
    async (content: JSONContent) => {
      if (!id) return;
      const result = await carbon
        ?.from("priceList")
        .update({
          notes: content,
          updatedAt: today(getLocalTimeZone()).toString(),
          updatedBy: userId
        })
        .eq("id", id);

      if (result?.error) {
        toast.error("Failed to save notes");
      }
    },
    2500,
    true
  );

  if (!id || !priceList) return null;

  const permissionModule = "sales";
  const canEdit = permissions.can("update", permissionModule);

  const isEmpty =
    !notes || (typeof notes === "object" && Object.keys(notes).length === 0);

  // Don't render the card if there are no notes and user can't edit
  if (isEmpty && !canEdit) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
      </CardHeader>
      <CardContent>
        {canEdit ? (
          <Editor
            initialValue={notes}
            onChange={(value) => {
              setNotes(value);
              onSave(value);
            }}
          />
        ) : (
          <div
            className="prose dark:prose-invert"
            dangerouslySetInnerHTML={{
              __html: generateHTML(notes as JSONContent)
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}
