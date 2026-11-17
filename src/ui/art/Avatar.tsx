import { Face, Hair, toEmotion } from "./Face";
import { C, SKIN, type HairStyle } from "./palette";

interface RoleLook {
  bg: string;
  skin: string;
  top: string;
  hair: HairStyle;
  label: string;
}

const ROLES: Record<string, RoleLook> = {
  casualty: { bg: "#fde68a", skin: SKIN[2], top: C.offwhite, hair: "short", label: "casualty" },
  bystander: { bg: "#d9f99d", skin: SKIN[3], top: C.sun, hair: "curly", label: "bystander" },
  adult: { bg: "#e7d3b1", skin: SKIN[1], top: C.green, hair: "short", label: "adult" },
  friend: { bg: C.sky, skin: SKIN[0], top: C.skyDeep, hair: "bun", label: "friend" },
  player: { bg: "#bbf7d0", skin: SKIN[4], top: C.green, hair: "short", label: "you" },
};

function Phone() {
  return (
    <g>
      <rect x={12} y={6} width={16} height={28} rx={3} fill={C.charcoal} />
      <rect x={14} y={10} width={12} height={18} rx={1} fill={C.offwhite} />
      <text x={20} y={22} textAnchor="middle" fontSize={7} fontWeight={800} fill={C.green} fontFamily="system-ui, sans-serif">
        907
      </text>
      <circle cx={20} cy={31} r={1.3} fill={C.steel} />
    </g>
  );
}

export function Avatar({ role, emotion, size = 40 }: { role: string; emotion: string; size?: number }) {
  const look = ROLES[role];
  const e = toEmotion(emotion);
  const label = look ? look.label : role;
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} role="img" aria-label={`${label}, ${e}`} style={{ display: "block", flexShrink: 0 }}>
      <defs>
        <clipPath id={`av-${role}`}>
          <circle cx={20} cy={20} r={20} />
        </clipPath>
      </defs>
      {role === "calltaker" ? (
        <g clipPath={`url(#av-${role})`}>
          <rect width={40} height={40} fill="#bbf7d0" />
          <circle cx={20} cy={20} r={19} fill="none" stroke={C.green} strokeWidth={2} />
          <Phone />
        </g>
      ) : (
        <g clipPath={`url(#av-${role})`}>
          <rect width={40} height={40} fill={(look ?? ROLES.friend).bg} />
          <ellipse cx={20} cy={42} rx={15} ry={11} fill={(look ?? ROLES.friend).top} stroke={C.outline} strokeOpacity={0.35} />
          <rect x={17} y={26} width={6} height={7} fill={(look ?? ROLES.friend).skin} />
          <g transform="translate(20 20)">
            <circle r={11} fill={(look ?? ROLES.friend).skin} stroke={C.outline} strokeOpacity={0.35} />
            <Hair r={11} style={(look ?? ROLES.friend).hair} />
            <Face r={11} emotion={e} />
          </g>
        </g>
      )}
    </svg>
  );
}
