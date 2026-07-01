export function RiskRating({
  rating,
  size = "default"
}: {
  rating: number;
  size?: "default" | "sm";
}) {
  const getColor = (rating: number) => {
    switch (rating) {
      case 5:
        return "bg-destructive";
      case 4:
        return "bg-status-orange";
      case 3:
        return "bg-warning";
      case 2:
        return "bg-success";
      case 1:
      default:
        return "bg-success";
    }
  };

  const getBarSize = (size: "default" | "sm") => {
    switch (size) {
      case "sm":
        return "h-3 w-1";
      case "default":
      default:
        return "h-4 w-2";
    }
  };

  const bars = Array.from({ length: rating }, (_, index) => (
    <div key={index} className={`${getBarSize(size)} ${getColor(rating)}`} />
  ));
  return <div className="flex items-center gap-0.5">{bars}</div>;
}
