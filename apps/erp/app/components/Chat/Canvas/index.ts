import { useArtifacts } from "@ai-sdk-tools/artifacts/client";

export function Canvas() {
  // @ts-expect-error TS2339 - TODO: fix type
  const { current } = useArtifacts({
    exclude: ["chat-title", "followup-questions"]
  });

  switch (current?.type) {
    // case "burn-rate":
    //   return <BurnRateCanvas />;
    default:
      return null;
  }
}
