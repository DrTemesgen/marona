import { Casualty, STATUS_LABEL } from "./Casualty";
import { NEUTRAL, SCENES } from "./backdrops";

export function Scene({ scene, casualty, className }: { scene: string; casualty: string; className?: string }) {
  const def = SCENES[scene] ?? NEUTRAL;
  const status = casualty in STATUS_LABEL ? casualty : "standing";
  const Backdrop = def.Backdrop;
  return (
    <svg
      viewBox="0 0 360 220"
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      style={{ display: "block" }}
      role="img"
      aria-label={`${def.label}. ${STATUS_LABEL[status]}`}
    >
      <Backdrop />
      <Casualty status={status} ground={def.ground} scene={scene} />
    </svg>
  );
}
