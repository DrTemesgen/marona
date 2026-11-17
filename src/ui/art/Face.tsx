import { C, type HairStyle } from "./palette";

export type Emotion = "calm" | "worried" | "panicked" | "pain" | "neutral";

export function toEmotion(e: string): Emotion {
  return e === "calm" || e === "worried" || e === "panicked" || e === "pain" ? e : "neutral";
}

// Hair drawn behind the face, centred on the head centre (0,0).
export function Hair({ r, style, color = "#111827" }: { r: number; style: HairStyle; color?: string }) {
  if (style === "none") return null;
  const cap = `M ${-r * 1.02} ${-r * 0.15} A ${r * 1.02} ${r * 1.02} 0 0 1 ${r * 1.02} ${-r * 0.15} Q 0 ${-r * 0.72} ${-r * 1.02} ${-r * 0.15} Z`;
  return (
    <g fill={color}>
      {style === "bun" && <circle cx={0} cy={-r * 1.12} r={r * 0.36} />}
      {style === "curly" &&
        [-0.7, -0.35, 0, 0.35, 0.7].map((k) => <circle key={k} cx={r * k} cy={-r * (0.95 - Math.abs(k) * 0.35)} r={r * 0.3} />)}
      <path d={cap} />
    </g>
  );
}

// Eyes, brows and mouth, centred on (0,0), head radius r.
export function Face({ r, emotion }: { r: number; emotion: Emotion }) {
  const ex = r * 0.38;
  const ey = -r * 0.08;
  const by = emotion === "panicked" ? -r * 0.62 : -r * 0.42;
  const sw = Math.max(r * 0.09, 0.5);
  const eye = r * (emotion === "panicked" ? 0.17 : 0.12);
  // Brow tilt: positive lifts the inner end (worry, fear, pain).
  const tilt = emotion === "worried" || emotion === "pain" ? r * 0.16 : emotion === "panicked" ? r * 0.1 : 0;
  const brow = (s: 1 | -1) => (
    <path d={`M ${s * (ex + r * 0.22)} ${by + tilt * 0.6} L ${s * (ex - r * 0.2)} ${by - tilt}`} />
  );
  const mouth = {
    calm: <path d={`M ${-r * 0.3} ${r * 0.36} Q 0 ${r * 0.62} ${r * 0.3} ${r * 0.36}`} />,
    worried: <path d={`M ${-r * 0.22} ${r * 0.52} Q 0 ${r * 0.4} ${r * 0.22} ${r * 0.52}`} />,
    panicked: <ellipse cx={0} cy={r * 0.5} rx={r * 0.17} ry={r * 0.22} fill={C.charcoal} />,
    pain: (
      <path
        d={`M ${-r * 0.28} ${r * 0.52} L ${-r * 0.14} ${r * 0.42} L 0 ${r * 0.52} L ${r * 0.14} ${r * 0.42} L ${r * 0.28} ${r * 0.52}`}
      />
    ),
    neutral: <path d={`M ${-r * 0.22} ${r * 0.48} L ${r * 0.22} ${r * 0.48}`} />,
  }[emotion];
  return (
    <g stroke={C.charcoal} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" fill="none">
      {emotion === "pain" ? (
        // Eyes squeezed shut.
        <>
          <path d={`M ${-ex - r * 0.12} ${ey - r * 0.08} L ${-ex + r * 0.1} ${ey} L ${-ex - r * 0.12} ${ey + r * 0.08}`} />
          <path d={`M ${ex + r * 0.12} ${ey - r * 0.08} L ${ex - r * 0.1} ${ey} L ${ex + r * 0.12} ${ey + r * 0.08}`} />
        </>
      ) : (
        <>
          <circle cx={-ex} cy={ey} r={eye} fill={C.charcoal} stroke="none" />
          <circle cx={ex} cy={ey} r={eye} fill={C.charcoal} stroke="none" />
        </>
      )}
      {brow(-1)}
      {brow(1)}
      {mouth}
    </g>
  );
}
