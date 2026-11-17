import type { ReactNode } from "react";
import { Face, Hair, type Emotion } from "./Face";
import { C, type Look } from "./palette";
import type { P, Pose } from "./poses";

const HEAD_R = 8;

function Limb({ pts, color, w }: { pts: P[]; color: string; w: number }) {
  const d = "M" + pts.map((p) => p.join(" ")).join(" L");
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke={C.outline} strokeOpacity={0.4} strokeWidth={w + 1.6} />
      <path d={d} stroke={color} strokeWidth={w} />
    </g>
  );
}

function Arm({ pose, side, look }: { pose: Pose; side: "armN" | "armF"; look: Look }) {
  const [elbow, hand] = pose[side];
  return (
    <>
      <Limb pts={[pose.neck, elbow, hand]} color={look.top} w={5} />
      <circle cx={hand[0]} cy={hand[1]} r={2.5} fill={look.skin} />
    </>
  );
}

function Leg({ pose, side, look }: { pose: Pose; side: "legN" | "legF"; look: Look }) {
  const [knee, foot] = pose[side];
  return (
    <>
      <Limb pts={[pose.hip, knee, foot]} color={look.bottom} w={6} />
      <circle cx={foot[0] + 2} cy={foot[1] - 1} r={3} fill={C.charcoal} />
    </>
  );
}

export interface PersonProps {
  pose: Pose;
  x: number; // ground x in the scene
  y: number; // ground y in the scene
  look: Look;
  s?: number; // scale
  flip?: boolean; // face left
  emotion?: Emotion;
  // "body" draws everything but the arms, "arms" only the arms (lets another
  // person stand "behind" this one and still reach round in front).
  parts?: "all" | "body" | "arms";
  children?: ReactNode; // extras drawn in local coordinates (above the body)
}

export function Person({ pose, x, y, look, s = 1.6, flip = false, emotion = "calm", parts = "all", children }: PersonProps) {
  const body = parts !== "arms";
  const arms = parts !== "body";
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
      {body && <Leg pose={pose} side="legF" look={look} />}
      {arms && <Arm pose={pose} side="armF" look={look} />}
      {body && (
        <>
          <Limb pts={[pose.neck, pose.hip]} color={look.top} w={12} />
          <Leg pose={pose} side="legN" look={look} />
          <Limb pts={[pose.neck, pose.head]} color={look.skin} w={4} />
          <g transform={`translate(${pose.head[0]} ${pose.head[1]})`}>
            <circle r={HEAD_R} fill={look.skin} stroke={C.outline} strokeOpacity={0.4} strokeWidth={1} />
            <Hair r={HEAD_R} style={look.hair} />
            <Face r={HEAD_R} emotion={emotion} />
          </g>
        </>
      )}
      {arms && <Arm pose={pose} side="armN" look={look} />}
      {children}
    </g>
  );
}
