export function GradientBar(props: unknown): React.JSX.Element {
  const { x, y, width, height, fill } = props as {
    x: number;
    y: number;
    width: number;
    height: number;
    fill: string;
  };

  if (!height || height <= 0 || !width || width <= 0) return <g />;

  const r = Math.min(4, width / 2, height);
  const gradientId = `bar-grad-${String(fill).replace(/[^a-zA-Z0-9]/g, "")}-${x}-${y}`;

  const d = `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;

  return (
    <g>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} stopOpacity={0.4} />
          <stop offset="100%" stopColor={fill} stopOpacity={0.4} />
        </linearGradient>
      </defs>
      <path d={d} fill={`url(#${gradientId})`} />
      <rect x={x} y={y} width={width} height={2} fill={fill} rx={r} />
    </g>
  );
}
