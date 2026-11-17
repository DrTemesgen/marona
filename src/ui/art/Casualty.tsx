import type { ReactNode } from "react";
import { WashStation, TAP_X, TAP_SPOUT_Y } from "./backdrops";
import { Person } from "./Person";
import { C, LOOKS } from "./palette";
import * as P from "./poses";

// The only red in the art: the wound patch.
const WOUND_RED = "#b91c1c";
const CX = 205; // where the casualty is drawn

export const STATUS_LABEL: Record<string, string> = {
  standing: "A student stands calmly.",
  chest_pain: "A student sits with a hand on the chest, looking in pain.",
  collapsed: "A student lies on their back and does not respond.",
  cpr: "A student kneels beside someone lying down, pressing on the centre of the chest with straight arms.",
  recovery: "A person lies on their side in the recovery position.",
  choking: "A student stands with both hands at the throat, unable to breathe.",
  back_blows: "A student leans forward while a helper behind gives blows between the shoulder blades.",
  abdominal_thrusts: "A helper stands behind a choking student with arms around the upper belly.",
  bleeding: "A student sits on the ground holding a bleeding forearm.",
  pressure: "A helper presses a clean cloth firmly on a bleeding forearm.",
  burn: "A child holds a burnt forearm.",
  cooling: "A child holds a burnt forearm under running water from a tap.",
  seizure: "A student lies on the floor shaking gently; objects have been moved away.",
  recovered: "A student sits up, calm and recovered.",
  lying_awake: "A person lies still on their back, awake, with a jacket over the body.",
  handover: "An ambulance has arrived; the casualty lies on a stretcher while two crew listen to the student helper.",
};

export const STATUSES = Object.keys(STATUS_LABEL);

function Shadow({ x, y, rx = 30 }: { x: number; y: number; rx?: number }) {
  return <ellipse cx={x} cy={y + 1} rx={rx} ry={4} fill="#000" opacity={0.13} />;
}

function Patch({ x, y, fill = WOUND_RED }: { x: number; y: number; fill?: string }) {
  return <ellipse cx={x} cy={y} rx={3} ry={2.6} fill={fill} />;
}

// ---- one small function per status ---------------------------------------

function Standing({ g }: { g: number }) {
  return <Person pose={P.stand} x={CX} y={g} look={LOOKS.casualty} />;
}

function ChestPain({ g }: { g: number }) {
  return <Person pose={P.chestPainPose} x={CX} y={g} look={LOOKS.casualty} emotion="pain" />;
}

function Collapsed({ g }: { g: number }) {
  return <Person pose={P.lyingBack} x={CX} y={g} look={LOOKS.casualty} emotion="neutral" />;
}

function Cpr({ g }: { g: number }) {
  return (
    <>
      <Person pose={P.lyingBack} x={CX} y={g} look={LOOKS.casualty} emotion="neutral" />
      {/* helper kneels beside the chest, a little nearer the viewer */}
      <Person pose={P.kneelCpr} x={CX - 25.6} y={g + 6} look={LOOKS.rescuer} emotion="worried" />
    </>
  );
}

function Recovery({ g }: { g: number }) {
  return <Person pose={P.recoveryPose} x={CX} y={g} look={LOOKS.casualty} emotion="neutral" />;
}

function Choking({ g }: { g: number }) {
  return <Person pose={P.chokingPose} x={CX} y={g} look={LOOKS.casualty} emotion="panicked" />;
}

function BackBlows({ g }: { g: number }) {
  const rescuer = { pose: P.backBlower, x: CX - 16, y: g, look: LOOKS.rescuer, emotion: "worried" as const };
  return (
    <>
      <Person {...rescuer} parts="body" />
      <Person pose={P.leanForward} x={CX} y={g} look={LOOKS.casualty} emotion="panicked" />
      <Person {...rescuer} parts="arms" />
    </>
  );
}

function AbdominalThrusts({ g }: { g: number }) {
  const rescuer = { pose: P.thruster, x: CX - 12, y: g, look: LOOKS.rescuer, emotion: "worried" as const };
  return (
    <>
      <Person {...rescuer} parts="body" />
      <Person pose={P.leanSlight} x={CX} y={g} look={LOOKS.casualty} emotion="panicked" />
      <Person {...rescuer} parts="arms" />
    </>
  );
}

function Bleeding({ g }: { g: number }) {
  return (
    <Person pose={P.holdingForearm} x={CX} y={g} look={LOOKS.casualty} emotion="pain">
      <Patch x={7.5} y={-27.5} />
    </Person>
  );
}

function Pressure({ g }: { g: number }) {
  return (
    <>
      <Person pose={P.holdingForearm} x={CX} y={g} look={LOOKS.casualty} emotion="worried">
        <g transform="rotate(12 7.5 -27)">
          <rect x={3} y={-32} width={9} height={9} rx={1} fill={C.offwhite} stroke={C.steel} strokeWidth={0.8} />
          <circle cx={7.5} cy={-27.5} r={1.6} fill={WOUND_RED} />
        </g>
      </Person>
      <Person pose={P.kneel} x={CX + 41.6} y={g} flip look={LOOKS.rescuer} emotion="calm" />
    </>
  );
}

const CHILD = 1.25;

function Burn({ g }: { g: number }) {
  return (
    <Person pose={P.holdingForearmStanding} x={CX} y={g} s={CHILD} look={LOOKS.child} emotion="pain">
      <Patch x={14.5} y={-50} fill={C.orange} />
    </Person>
  );
}

function Cooling({ g, scene }: { g: number; scene: string }) {
  const handY = g - 38 * CHILD;
  const handX = CX + 20 * CHILD;
  return (
    <>
      {scene !== "home-kitchen" && <WashStation ground={g} />}
      <Person pose={P.underTap} x={CX} y={g} s={CHILD} look={LOOKS.child} emotion="worried">
        <Patch x={16} y={-40} fill={C.orange} />
      </Person>
      <g stroke={C.water} strokeWidth={2.5} strokeLinecap="round" opacity={0.9}>
        <path d={`M ${TAP_X} ${TAP_SPOUT_Y + 2} V ${handY - 2}`} />
        <path d={`M ${handX - 5} ${handY + 3} v 8 M ${handX + 6} ${handY + 3} v 9`} strokeWidth={1.8} />
      </g>
    </>
  );
}

function Seizure({ g }: { g: number }) {
  return (
    <>
      {/* objects moved well away: a school bag and a chair */}
      <rect x={60} y={g - 24} width={26} height={24} rx={5} fill={C.green} />
      <rect x={64} y={g - 16} width={18} height={8} rx={2} fill="#166534" />
      <g stroke={C.charcoal} strokeWidth={3} strokeLinecap="round" fill="none">
        <path d={`M 300 ${g - 40} V ${g - 18} H 322 M 322 ${g - 18} V ${g}`} />
        <path d={`M 300 ${g - 18} V ${g}`} />
      </g>
      <rect x={298} y={g - 44} width={4} height={26} fill={C.charcoal} />
      <Person pose={P.lyingJerk} x={CX} y={g} look={LOOKS.casualty} emotion="neutral">
        <g stroke={C.charcoal} strokeWidth={1.2} strokeLinecap="round" fill="none" opacity={0.6}>
          <path d="M -22 -18 q -4 3 0 6 M -17 -20 q -4 3 0 6" />
          <path d="M 38 -16 q 4 3 0 6 M 43 -14 q 4 3 0 6" />
          <path d="M -8 -22 q 3 -3 6 0" />
        </g>
      </Person>
    </>
  );
}

// Lying on the back, eyes open, a jacket spread over the chest and arms.
function LyingCovered({ x, y }: { x: number; y: number }) {
  return (
    <Person pose={P.lyingAwake} x={x} y={y} look={LOOKS.casualty} emotion="calm">
      <g stroke={C.outline} strokeOpacity={0.4} strokeWidth={0.8} strokeLinejoin="round">
        <path d="M -27 -13 Q -12 -16 6 -13 L 8 1 Q -10 3 -27 1 Z" fill={C.blue} />
        <path d="M -27 -13 L -22 -7 L -27 -1 Z" fill="#1d4ed8" />
        <path d="M -10 -14.5 L -10 2" fill="none" stroke={C.offwhite} strokeOpacity={0.7} />
      </g>
    </Person>
  );
}

function LyingAwake({ g }: { g: number }) {
  return <LyingCovered x={CX} y={g} />;
}

// A wheeled ambulance stretcher; x is the centre of the mattress, its top 14 above the ground.
const STRETCHER_TOP = 14;
function Stretcher({ x, g }: { x: number; g: number }) {
  const top = g - STRETCHER_TOP;
  return (
    <g>
      <path
        d={`M ${x - 40} ${top + 4} L ${x - 40} ${g - 5} M ${x + 40} ${top + 4} L ${x + 40} ${g - 5} M ${x - 44} ${top + 7} H ${x + 44}`}
        stroke={C.steel}
        strokeWidth={1.8}
        fill="none"
        strokeLinecap="round"
      />
      <rect x={x - 48} y={top} width={96} height={4.5} rx={2} fill={C.offwhite} stroke={C.steel} strokeWidth={0.9} />
      <circle cx={x - 40} cy={g - 2.6} r={2.6} fill={C.charcoal} />
      <circle cx={x + 40} cy={g - 2.6} r={2.6} fill={C.charcoal} />
    </g>
  );
}

function Recovered({ g }: { g: number }) {
  return <Person pose={P.calmSitting} x={CX} y={g} look={LOOKS.casualty} emotion="calm" />;
}

function Ambulance({ x, g }: { x: number; g: number }) {
  return (
    <g transform={`translate(${x} ${g})`} fontFamily="system-ui, sans-serif">
      <rect x={0} y={-68} width={78} height={54} rx={4} fill={C.offwhite} stroke={C.steel} />
      <path d="M 78 -52 L 100 -52 L 114 -30 L 114 -14 L 78 -14 Z" fill={C.offwhite} stroke={C.steel} />
      <path d="M 84 -47 L 98 -47 L 108 -31 L 84 -31 Z" fill="#7ab8d8" />
      <rect x={0} y={-28} width={114} height={7} fill={C.green} />
      <rect x={38} y={-76} width={16} height={8} rx={2} fill={C.sun} />
      <rect x={6} y={-62} width={22} height={22} rx={3} fill={C.green} />
      <path d="M 17 -59 V -43 M 9 -51 H 25" stroke={C.offwhite} strokeWidth={5} />
      <text x={32} y={-52} fontSize={8} fontWeight={700} fill={C.green}>AMBULANCE</text>
      <text x={33} y={-38} fontSize={12} fontWeight={800} fill={C.charcoal}>907</text>
      <circle cx={26} cy={-10} r={9} fill={C.charcoal} />
      <circle cx={26} cy={-10} r={4} fill={C.offwhite} />
      <circle cx={92} cy={-10} r={9} fill={C.charcoal} />
      <circle cx={92} cy={-10} r={4} fill={C.offwhite} />
    </g>
  );
}

function Handover({ g }: { g: number }) {
  return (
    <>
      <Ambulance x={238} g={g + 2} />
      {/* the casualty stays lying down, covered, on the crew's stretcher */}
      <Shadow x={108} y={g} rx={44} />
      <Stretcher x={106} g={g} />
      <LyingCovered x={110} y={g - STRETCHER_TOP} />
      <Person pose={P.pointing} x={34} y={g} look={LOOKS.rescuer} emotion="calm" />
      <Person pose={P.stand} x={178} y={g + 3} s={1.5} flip look={LOOKS.crewA} emotion="calm" />
      <Person pose={P.stand} x={206} y={g + 3} s={1.5} flip look={LOOKS.crewB} emotion="calm" />
    </>
  );
}

const FIGURES: Record<string, (p: { g: number; scene: string }) => ReactNode> = {
  standing: Standing,
  chest_pain: ChestPain,
  collapsed: Collapsed,
  cpr: Cpr,
  recovery: Recovery,
  choking: Choking,
  back_blows: BackBlows,
  abdominal_thrusts: AbdominalThrusts,
  bleeding: Bleeding,
  pressure: Pressure,
  burn: Burn,
  cooling: Cooling,
  seizure: Seizure,
  recovered: Recovered,
  lying_awake: LyingAwake,
  handover: Handover,
};

// Casualty (and helpers) drawn in front of a scene. Unknown status = standing.
export function Casualty({ status, ground, scene }: { status: string; ground: number; scene: string }) {
  const Figure = FIGURES[status] ?? Standing;
  const known = status in FIGURES;
  return (
    <g>
      {known && status !== "handover" && <Shadow x={CX} y={ground} />}
      <Figure g={ground} scene={scene} />
    </g>
  );
}
