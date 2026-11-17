import type { ReactNode } from "react";
import { Person } from "./Person";
import { stand } from "./poses";
import { C, LOOKS } from "./palette";

// Each backdrop fills the 360 x 220 picture. "ground" is the y where people stand.
export interface SceneDef {
  ground: number;
  label: string; // plain-words description for aria-label
  Backdrop: () => ReactNode;
}

const Sky = ({ fill = C.sky }: { fill?: string }) => <rect width={360} height={220} fill={fill} />;

function Rect(p: { x: number; y: number; w: number; h: number; fill: string; rx?: number }) {
  return <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={p.fill} rx={p.rx} />;
}

function Wheel({ x, y, r = 9 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={C.charcoal} />
      <circle cx={x} cy={y} r={r * 0.42} fill={C.offwhite} />
    </g>
  );
}

function Windows({ x, y, cols, rows, dx = 16, dy = 18 }: { x: number; y: number; cols: number; rows: number; dx?: number; dy?: number }) {
  const out: ReactNode[] = [];
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++) out.push(<rect key={`${i}-${j}`} x={x + i * dx} y={y + j * dy} width={9} height={11} fill="#7a98ad" />);
  return <g>{out}</g>;
}

function Tree({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <rect x={-5} y={-50} width={10} height={50} fill="#7c4a1d" />
      <circle cx={0} cy={-62} r={28} fill={C.leaf} />
      <circle cx={-16} cy={-48} r={18} fill={C.leafLight} />
      <circle cx={17} cy={-50} r={17} fill={C.leaf} />
    </g>
  );
}

function Cone({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <path d={`M ${x - 6} ${y} L ${x - 2} ${y - 16} L ${x + 2} ${y - 16} L ${x + 6} ${y} Z`} fill={C.orange} />
      <rect x={x - 4} y={y - 9} width={8} height={3} fill={C.offwhite} />
      <rect x={x - 8} y={y - 1} width={16} height={3} rx={1} fill={C.charcoal} />
    </g>
  );
}

// ---- street pieces -------------------------------------------------------

function StreetBase({ kerbY }: { kerbY: number }) {
  return (
    <g>
      <Sky />
      <Rect x={0} y={kerbY - 50} w={360} h={60} fill={C.pavement} />
      <Rect x={0} y={kerbY} w={360} h={6} fill={C.steel} />
      <Rect x={0} y={kerbY + 6} w={360} h={220 - kerbY} fill={C.road} />
      <path d={`M 0 ${kerbY + 36} H 360`} stroke={C.offwhite} strokeWidth={2.5} strokeDasharray="18 14" opacity={0.7} />
    </g>
  );
}

function Minibus({ x, y }: { x: number; y: number }) {
  // Blue-and-white minibus taxi, y = wheel centre line.
  return (
    <g transform={`translate(${x} ${y})`}>
      <Rect x={0} y={-62} w={128} h={50} fill={C.offwhite} rx={8} />
      <Rect x={0} y={-30} w={128} h={20} fill={C.blue} rx={4} />
      <Rect x={0} y={-62} w={128} h={7} fill={C.blue} rx={3} />
      {[8, 34, 60, 86].map((wx) => (
        <Rect key={wx} x={wx} y={-50} w={22} h={15} fill="#7ab8d8" rx={2} />
      ))}
      <path d="M 108 -52 L 124 -52 L 124 -35 L 108 -35 Z" fill="#7ab8d8" />
      <circle cx={122} cy={-23} r={3} fill={C.sun} />
      <Wheel x={28} y={-3} />
      <Wheel x={98} y={-3} />
    </g>
  );
}

function SmallCar({ x, y, body = "#6b7280" }: { x: number; y: number; body?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Rect x={0} y={-24} w={80} h={16} fill={body} rx={5} />
      <path d="M 16 -24 L 26 -38 L 56 -38 L 66 -24 Z" fill={body} />
      <path d="M 28 -35 L 36 -35 L 36 -26 L 22 -26 Z M 40 -35 L 54 -35 L 61 -26 L 40 -26 Z" fill={C.sky} />
      <Wheel x={18} y={-6} r={8} />
      <Wheel x={62} y={-6} r={8} />
    </g>
  );
}

function Bajaj({ x, y }: { x: number; y: number }) {
  // Blue-and-white three-wheeler taxi, parked. y = ground.
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M 0 -18 L 6 -44 L 52 -44 L 60 -18 Z" fill={C.blue} />
      <path d="M 6 -44 L 52 -44 L 50 -52 L 10 -52 Z" fill={C.offwhite} />
      <path d="M 14 -42 L 46 -42 L 48 -30 L 10 -30 Z" fill="#7ab8d8" />
      <path d="M 52 -44 L 70 -24 L 70 -14 L 56 -14 Z" fill={C.offwhite} />
      <Wheel x={14} y={-8} r={8} />
      <Wheel x={44} y={-8} r={8} />
      <Wheel x={66} y={-6} r={6} />
    </g>
  );
}

function Motorbike({ x, y }: { x: number; y: number }) {
  // Fallen motorbike lying on its side, seen slightly from above.
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M -50 12 Q -10 18 40 12" stroke={C.charcoal} strokeOpacity={0.3} strokeWidth={3} fill="none" />
      <ellipse cx={-34} cy={0} rx={13} ry={5} fill={C.charcoal} />
      <ellipse cx={34} cy={-4} rx={13} ry={5} fill={C.charcoal} />
      <path d="M -34 0 L -6 -8 L 34 -4" stroke={C.steel} strokeWidth={4} fill="none" strokeLinecap="round" />
      <ellipse cx={4} cy={-10} rx={17} ry={8} fill={C.sun} />
      <ellipse cx={-16} cy={-9} rx={13} ry={5} fill={C.charcoal} />
      <path d="M 34 -4 L 30 -22 M 24 -22 L 38 -22" stroke={C.charcoal} strokeWidth={3} fill="none" strokeLinecap="round" />
    </g>
  );
}

// ---- the six scenes ------------------------------------------------------

function MinibusStop() {
  return (
    <g>
      <StreetBase kerbY={172} />
      <Rect x={0} y={64} w={70} h={78} fill={C.wallWarm} />
      <Rect x={70} y={86} w={80} h={56} fill={C.wallDark} />
      <Rect x={150} y={50} w={64} h={92} fill="#dcc9a6" />
      <Rect x={214} y={78} w={80} h={64} fill={C.wallWarm} />
      <Rect x={294} y={60} w={66} h={82} fill={C.wallDark} />
      <Windows x={10} y={74} cols={3} rows={3} />
      <Windows x={160} y={60} cols={3} rows={4} dx={17} />
      <Windows x={224} y={88} cols={4} rows={2} />
      <Windows x={304} y={70} cols={3} rows={3} />
      <Minibus x={12} y={204} />
      <SmallCar x={272} y={206} />
    </g>
  );
}

function SchoolGate() {
  return (
    <g>
      <Sky />
      <Rect x={0} y={104} w={360} h={58} fill="#e7d9c0" />
      <Rect x={0} y={100} w={360} h={6} fill="#9a7b4f" />
      <Rect x={0} y={158} w={360} h={62} fill={C.earth} />
      <path d="M 90 158 L 270 158 L 330 220 L 30 220 Z" fill={C.earthLight} />
      {[40, 48, 56, 64, 72, 80, 88].map((bx) => (
        <Rect key={bx} x={bx} y={92} w={2.5} h={68} fill={C.green} />
      ))}
      <Rect x={36} y={92} w={56} h={3} fill={C.green} />
      <Rect x={18} y={78} w={20} h={84} fill="#6b5b45" />
      <Rect x={92} y={78} w={20} h={84} fill="#6b5b45" />
      <Rect x={22} y={86} w={12} h={8} fill={C.green} />
      <Rect x={96} y={86} w={12} h={8} fill={C.green} />
      <Tree x={312} y={162} />
      <Person pose={stand} x={135} y={164} s={0.5} look={LOOKS.distant} />
      <Person pose={stand} x={150} y={166} s={0.5} look={LOOKS.distant2} />
      <Person pose={stand} x={268} y={165} s={0.5} look={LOOKS.distant2} />
      <Person pose={stand} x={282} y={163} s={0.5} look={LOOKS.distant} />
    </g>
  );
}

function LunchBreak() {
  return (
    <g>
      <Sky />
      <Rect x={0} y={62} w={360} h={80} fill="#e8dcc0" />
      <Rect x={0} y={56} w={360} h={8} fill={C.green} />
      <Windows x={20} y={78} cols={6} rows={2} dx={26} dy={24} />
      <Rect x={190} y={92} w={22} h={50} fill={C.green} />
      <Windows x={236} y={78} cols={4} rows={2} dx={26} dy={24} />
      <Rect x={0} y={140} w={360} h={80} fill="#cdb893" />
      <path d="M 0 170 H 360 M 0 200 H 360" stroke="#b8a37c" strokeWidth={1.5} />
      {/* bench with food */}
      <Rect x={14} y={150} w={112} h={9} fill={C.wood} rx={2} />
      <Rect x={22} y={159} w={6} h={22} fill="#7c3a0c" />
      <Rect x={112} y={159} w={6} h={22} fill="#7c3a0c" />
      <Rect x={24} y={138} w={30} h={12} fill={C.sun} rx={2} />
      <Rect x={24} y={138} w={30} h={4} fill="#ca8a04" rx={2} />
      <circle cx={70} cy={144} r={7} fill="#d4a15f" />
      <circle cx={84} cy={145} r={6} fill="#d4a15f" />
      <circle cx={98} cy={145} r={5} fill={C.orange} />
      <Rect x={106} y={132} w={9} h={18} fill={C.skyDeep} rx={2} />
      <Rect x={108} y={128} w={5} h={5} fill={C.blue} />
      <Tree x={330} y={160} s={0.9} />
      <Person pose={stand} x={290} y={156} s={0.5} look={LOOKS.distant2} />
    </g>
  );
}

function RoadCrash() {
  return (
    <g>
      <StreetBase kerbY={176} />
      {/* school building and fence */}
      <Rect x={0} y={60} w={150} h={78} fill={C.wallWarm} />
      <Rect x={0} y={54} w={150} h={8} fill={C.green} />
      <Windows x={12} y={74} cols={7} rows={2} dx={19} dy={24} />
      <Rect x={150} y={118} w={210} h={4} fill={C.steel} />
      {Array.from({ length: 22 }, (_, i) => (
        <Rect key={i} x={152 + i * 10} y={112} w={2.5} h={26} fill={C.steel} />
      ))}
      {/* bajaj parked on the pavement, cones beside the fallen bike */}
      <Bajaj x={16} y={172} />
      <Motorbike x={296} y={206} />
      <Cone x={246} y={212} />
      <Cone x={348} y={206} />
    </g>
  );
}

// Tap position shared with the "cooling" pose (see Casualty.tsx).
export const TAP_X = 230;
export const TAP_SPOUT_Y = 132;
export const SINK_TOP_Y = 150;

function Tap() {
  return (
    <g fill="none" stroke={C.steel} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
      <path d={`M 246 ${SINK_TOP_Y} V 126 H ${TAP_X} V ${TAP_SPOUT_Y}`} />
      <path d="M 240 120 H 252" strokeWidth={3} />
    </g>
  );
}

// Sink basin and tap (water is drawn only by the cooling pose).
function Sink() {
  return (
    <g>
      <Rect x={202} y={SINK_TOP_Y} w={50} h={9} fill={C.steel} rx={2} />
      <Rect x={206} y={SINK_TOP_Y + 3} w={42} h={4} fill="#64748b" />
      <Tap />
    </g>
  );
}

function Counter() {
  return (
    <g>
      <Rect x={160} y={156} w={200} h={36} fill="#8a5a2b" />
      <path d="M 260 156 V 192" stroke="#6f4620" strokeWidth={2} />
      <Rect x={156} y={148} w={204} h={8} fill={C.steelLight} />
      <Sink />
    </g>
  );
}

function Kettle({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M -12 0 L -9 -18 L 9 -18 L 12 0 Z" fill={C.steel} />
      <path d="M -9 -18 Q 0 -28 9 -18" fill={C.steel} />
      <circle cx={0} cy={-26} r={2.5} fill={C.charcoal} />
      <path d="M 12 -8 L 22 -16 L 24 -13 L 14 -2 Z" fill={C.steel} />
      <path d="M -10 -14 Q -22 -14 -18 -4" stroke={C.charcoal} strokeWidth={3} fill="none" />
    </g>
  );
}

function HomeKitchen() {
  return (
    <g>
      <Rect x={0} y={0} w={360} h={170} fill="#fde9c9" />
      <Rect x={0} y={96} w={360} h={74} fill="#f6e3bf" />
      <path d="M 0 118 H 360 M 0 140 H 360" stroke="#ead4a6" strokeWidth={1.5} />
      <Rect x={0} y={170} w={360} h={50} fill={C.woodLight} />
      <path d="M 0 188 H 360 M 0 206 H 360" stroke="#a9733f" strokeWidth={1.5} />
      <Rect x={20} y={26} w={64} h={58} fill={C.offwhite} rx={3} />
      <Rect x={25} y={31} w={54} h={48} fill={C.sky} />
      <path d="M 52 31 V 79 M 25 55 H 79" stroke={C.offwhite} strokeWidth={3} />
      <Counter />
      <Kettle x={318} y={148} />
    </g>
  );
}

// A wash basin on a post, used when the tap is needed outside the kitchen.
export function WashStation({ ground }: { ground: number }) {
  return (
    <g>
      <Rect x={244} y={126} w={5} h={ground - 126} fill={C.steel} />
      <path d="M 212 152 L 252 152 L 246 168 L 218 168 Z" fill={C.steelLight} stroke={C.steel} strokeWidth={1.5} />
      <Rect x={206} y={149} w={52} h={4} fill={C.steel} rx={2} />
      <path d={`M 246 126 H ${TAP_X} V ${TAP_SPOUT_Y}`} stroke={C.steel} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function Desk({ x, y, w }: { x: number; y: number; w: number }) {
  return (
    <g>
      <Rect x={x + 6} y={y + 12} w={4} h={22} fill={C.charcoal} />
      <Rect x={x + w - 10} y={y + 12} w={4} h={22} fill={C.charcoal} />
      <Rect x={x} y={y} w={w} h={13} fill="#b0763a" rx={2} />
      <Rect x={x} y={y} w={w} h={4} fill="#c98f52" rx={2} />
    </g>
  );
}

function Classroom() {
  return (
    <g>
      <Rect x={0} y={0} w={360} h={134} fill="#f2e6cc" />
      <Rect x={0} y={134} w={360} h={86} fill={C.woodLight} />
      <path d="M 0 160 H 360 M 0 190 H 360" stroke="#a9733f" strokeWidth={1.5} />
      <Rect x={92} y={22} w={176} h={74} fill={C.wood} rx={3} />
      <Rect x={98} y={28} w={164} h={62} fill={C.greenDark} />
      <path
        d="M 110 44 q 10 -8 20 0 t 20 0 M 110 58 h 60 M 110 70 q 10 -8 20 0 t 20 0 M 196 48 h 50 M 196 62 h 36"
        stroke={C.offwhite}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        opacity={0.85}
      />
      <Rect x={92} y={96} w={176} h={4} fill="#6f3a0c" />
      <circle cx={312} cy={36} r={14} fill={C.offwhite} stroke={C.charcoal} strokeWidth={2} />
      <path d="M 312 36 V 28 M 312 36 L 318 40" stroke={C.charcoal} strokeWidth={2} strokeLinecap="round" />
      <Desk x={8} y={142} w={78} />
      <Desk x={274} y={142} w={78} />
      <Desk x={0} y={170} w={92} />
      <Desk x={268} y={170} w={92} />
    </g>
  );
}

function Neutral() {
  return (
    <g>
      <Sky fill="#e0f2fe" />
      <Rect x={0} y={150} w={360} h={70} fill={C.pavement} />
    </g>
  );
}

export const SCENES: Record<string, SceneDef> = {
  "minibus-stop": {
    ground: 170,
    label: "A street in Addis Ababa with a blue and white minibus taxi at the kerb and other traffic",
    Backdrop: MinibusStop,
  },
  "school-gate": {
    ground: 182,
    label: "A school gate and wall with a tree, and students in uniform in the distance",
    Backdrop: SchoolGate,
  },
  "lunch-break": {
    ground: 186,
    label: "A school courtyard at lunch break with a bench holding food",
    Backdrop: LunchBreak,
  },
  "road-crash": {
    ground: 172,
    label: "A road beside a school with a fallen motorbike and a three-wheeler taxi parked safely",
    Backdrop: RoadCrash,
  },
  "home-kitchen": {
    ground: 198,
    label: "A home kitchen with a sink and tap and a kettle",
    Backdrop: HomeKitchen,
  },
  classroom: {
    ground: 192,
    label: "A classroom with desks and a blackboard",
    Backdrop: Classroom,
  },
};

export const NEUTRAL: SceneDef = { ground: 180, label: "A plain background", Backdrop: Neutral };
