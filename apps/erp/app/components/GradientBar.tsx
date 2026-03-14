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

  const d = `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;

  return (
    <g>
      <path d={d} fill={fill} fillOpacity={0.12} />
      <rect x={x} y={y} width={width} height={2} fill={fill} rx={r} />
    </g>
  );
}
