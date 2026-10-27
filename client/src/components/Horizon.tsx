/** The curved rim of a planet along the bottom of the screen: solid black, outlined with fine lines. */
export function Horizon() {
  const arcs = Array.from({ length: 16 }, (_, i) => i);
  return (
    <svg className="horizon" viewBox="0 0 1440 240" preserveAspectRatio="none" aria-hidden="true">
      {/* The planet itself is solid black, so stars do not show through it. */}
      <path d="M -200 240 Q 720 40 1640 240 Z" fill="#000" />
      {arcs.map((i) => (
        <path
          key={i}
          d={`M -200 ${240 + i * 2} Q 720 ${40 + i * 9} 1640 ${240 + i * 2}`}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={Math.max(0.03, 0.38 - i * 0.024)}
          strokeWidth={i === 0 ? 1.4 : 0.8}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
