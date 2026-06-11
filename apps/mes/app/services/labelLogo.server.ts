import { SUPABASE_URL } from "@carbon/auth";
import type { DocumentTemplate } from "@carbon/documents/template";
import { resolveTemplate } from "@carbon/documents/template";
import type { LabelSize } from "@carbon/utils";

export interface ResolvedLabelLogo {
  color?: string | null;
  mono?: string | null;
  gfa?: string | null;
  widthDots?: number;
}

/** See the ERP twin (`apps/erp/.../settings/labelLogo.server.ts`). */
export async function resolveLabelLogo(
  company: { logoLight?: string | null; logoLightIcon?: string | null } | null,
  template: DocumentTemplate | null,
  labelSize: LabelSize
): Promise<ResolvedLabelLogo | null> {
  const resolved = resolveTemplate("trackingLabel", template);
  const logoBlock = resolved.blocks.find(
    (b) => b.type === "labelLogo" && b.visible
  );
  if (!logoBlock) return null;
  const variant = logoBlock.type === "labelLogo" ? logoBlock.variant : "mark";
  const crop = logoBlock.type === "labelLogo" ? logoBlock.crop : undefined;
  const color =
    variant === "icon"
      ? (company?.logoLightIcon ?? company?.logoLight)
      : (company?.logoLight ?? company?.logoLightIcon);
  if (!color) return null;

  const dpi = labelSize.zpl?.dpi ?? 203;
  const labelInches = labelSize.zpl?.width ?? labelSize.width;
  const widthDots = Math.round(labelInches * dpi * 0.3);

  try {
    const imgRes = await fetch(color);
    const blob = await imgRes.blob();
    const formData = new FormData();
    formData.append("file", blob, "logo.png");
    formData.append("widthDots", String(widthDots));
    if (crop) {
      formData.append("cropX", String(crop.x));
      formData.append("cropY", String(crop.y));
      formData.append("cropW", String(crop.width));
      formData.append("cropH", String(crop.height));
    }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/logo-resizer`, {
      method: "POST",
      body: formData
    });
    const json = (await res.json()) as {
      monoPng?: string;
      gfa?: string;
      widthDots?: number;
    };
    return {
      color,
      mono: json.monoPng,
      gfa: json.gfa,
      widthDots: json.widthDots
    };
  } catch {
    return { color };
  }
}
