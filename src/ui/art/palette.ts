// Shared colours for the drawings. Red is NOT here on purpose: it is used
// only for the wound patch (see WOUND_RED in Casualty.tsx).
export const C = {
  green: "#15803d",
  greenDark: "#14532d",
  sun: "#facc15",
  charcoal: "#1f2937",
  offwhite: "#fafaf9",
  sky: "#bae6fd",
  skyDeep: "#7dd3fc",
  blue: "#2563eb",
  steel: "#9ca3af",
  steelLight: "#cbd5e1",
  road: "#4b5563",
  pavement: "#d6c9ad",
  earth: "#c9a66b",
  earthLight: "#e2cfa0",
  wallWarm: "#e7d3b1",
  wallDark: "#c9a77c",
  wood: "#92400e",
  woodLight: "#c08a52",
  leaf: "#4d7c0f",
  leafLight: "#65a30d",
  orange: "#fb923c",
  water: "#7dd3fc",
  outline: "#1f2937",
} as const;

// A range of brown skin tones (dark to medium).
export const SKIN = ["#5c3a21", "#7a4a2a", "#9a6236", "#b87a4b", "#d19a66"] as const;

export type HairStyle = "short" | "bun" | "curly" | "none";

export interface Look {
  skin: string;
  top: string;
  bottom: string;
  hair: HairStyle;
}

// Students in school uniform: off-white or sky shirt, charcoal trousers.
export const LOOKS = {
  casualty: { skin: SKIN[2], top: C.offwhite, bottom: C.charcoal, hair: "short" } as Look,
  rescuer: { skin: SKIN[1], top: C.skyDeep, bottom: C.charcoal, hair: "bun" } as Look,
  child: { skin: SKIN[3], top: C.sun, bottom: C.charcoal, hair: "curly" } as Look,
  crewA: { skin: SKIN[0], top: C.green, bottom: C.charcoal, hair: "short" } as Look,
  crewB: { skin: SKIN[4], top: C.green, bottom: C.charcoal, hair: "bun" } as Look,
  distant: { skin: SKIN[2], top: C.offwhite, bottom: C.charcoal, hair: "short" } as Look,
  distant2: { skin: SKIN[0], top: C.skyDeep, bottom: C.charcoal, hair: "curly" } as Look,
};
