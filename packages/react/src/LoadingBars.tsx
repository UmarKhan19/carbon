export function LoadingBars() {
  return (
    <div className="flex items-end justify-center gap-1 h-8">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="w-2 rounded-xs bg-primary"
          style={{
            animationName: "loading-bars",
            animationDuration: "1.2s",
            animationTimingFunction: "ease-in-out",
            animationIterationCount: "infinite",
            animationDelay: `${i * 0.1}s`
          }}
        />
      ))}
      <style>
        {`@keyframes loading-bars {
              0%, 100% { height: 8px; opacity: 0.3; }
              50% { height: 32px; opacity: 1; }
            }`}
      </style>
    </div>
  );
}
