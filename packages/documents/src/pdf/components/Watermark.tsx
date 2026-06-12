import { Image, View } from "@react-pdf/renderer";

/**
 * Faint, page-fixed company watermark behind the document. Renders nothing when
 * disabled or when no watermark logo is set. Shared by every document that
 * supports a watermark.
 */
export function Watermark({
  src,
  show
}: {
  src?: string | null;
  show?: boolean;
}) {
  if (!show || !src) return null;
  return (
    <View
      fixed
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        marginTop: 100,
        opacity: 0.07
      }}
    >
      <Image src={src} style={{ width: "50%" }} />
    </View>
  );
}
