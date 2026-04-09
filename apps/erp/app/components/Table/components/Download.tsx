import {
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { json2csv } from "json-2-csv";
import { useCallback } from "react";
import { LuDownload } from "react-icons/lu";

type DownloadProps = {
  data: object[];
};

const Download = ({ data }: DownloadProps) => {
  const { t } = useLingui();
  const onClick = useCallback(() => {
    if (!data?.length) {
      return;
    }
    let csvData = json2csv(data);
    // Create a CSV file and allow the user to download it
    let blob = new Blob([csvData], { type: "text/csv" });
    let url = window.URL.createObjectURL(blob);
    let a = document.createElement("a");
    a.href = url;
    a.download = "data.csv";
    document.body.appendChild(a);
    a.click();
  }, [data]);

  if (!data?.length) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <IconButton
          aria-label={t`Download CSV`}
          title={t`Download CSV`}
          variant={"ghost"}
          icon={<LuDownload />}
          className={"!border-dashed border-border"}
          onClick={onClick}
        />
      </TooltipTrigger>
      <TooltipContent>
        <p>
          <Trans>Download CSV</Trans>
        </p>
      </TooltipContent>
    </Tooltip>
  );
};

export default Download;
