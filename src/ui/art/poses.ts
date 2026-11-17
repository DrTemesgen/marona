// Body poses as skeleton points. Local units: the person is about 70 high,
// origin on the ground under the hips, facing right (x grows to the right,
// y grows downward, so up is negative). "N" = near limb, "F" = far limb.
export type P = [number, number];
export interface Pose {
  head: P;
  neck: P; // also the shoulder point
  hip: P;
  armN: [P, P]; // elbow, hand
  armF: [P, P];
  legN: [P, P]; // knee, foot
  legF: [P, P];
}

export const stand: Pose = {
  head: [0, -62], neck: [0, -51], hip: [0, -27],
  armN: [[-7, -40], [-8, -28]], armF: [[7, -40], [8, -28]],
  legN: [[-3, -13], [-4, 0]], legF: [[3, -13], [4, 0]],
};

// Hands at the throat.
export const chokingPose: Pose = {
  ...stand,
  armN: [[-9, -42], [-2, -48]], armF: [[9, -42], [2, -48]],
};

// Leaning forward (back blows).
export const leanForward: Pose = {
  head: [16, -52], neck: [9, -45], hip: [-1, -26],
  armN: [[13, -35], [15, -25]], armF: [[11, -34], [18, -27]],
  legN: [[-3, -13], [-4, 0]], legF: [[3, -13], [4, 0]],
};

// Leaning a little, arms up to the throat (abdominal thrusts).
export const leanSlight: Pose = {
  head: [8, -60], neck: [3, -50], hip: [-1, -27],
  armN: [[-4, -41], [1, -47]], armF: [[10, -42], [6, -47]],
  legN: [[-3, -13], [-4, 0]], legF: [[3, -13], [4, 0]],
};

// Rescuer standing behind, one hand striking the upper back.
export const backBlower: Pose = {
  ...stand,
  armN: [[5, -40], [14, -46]], armF: [[5, -40], [12, -35]],
};

// Rescuer standing behind, arms around the upper belly.
export const thruster: Pose = {
  ...stand,
  armN: [[6, -41], [12, -34]], armF: [[5, -38], [11, -35]],
};

// Sitting on the ground, legs forward.
export const sitLegs: Pose = {
  head: [-2, -42], neck: [-2, -31], hip: [0, -5],
  armN: [[6, -22], [12, -9]], armF: [[-8, -20], [-6, -8]],
  legN: [[15, -9], [30, -3]], legF: [[14, -12], [28, -6]],
};

export const chestPainPose: Pose = {
  ...sitLegs,
  armN: [[6, -17], [-1, -23]], armF: [[-6, -18], [8, -12]],
};

// Sitting on the ground, knees up.
export const sitKnees: Pose = {
  head: [-2, -42], neck: [-2, -31], hip: [0, -5],
  armN: [[8, -22], [13, -25]], armF: [[-8, -20], [-6, -8]],
  legN: [[11, -19], [15, -1]], legF: [[9, -17], [12, -1]],
};

export const calmSitting: Pose = {
  ...sitKnees,
  armN: [[6, -20], [11, -22]], armF: [[-6, -19], [10, -19]],
};

// Sitting, holding the injured forearm; the patch sits near (7,-27).
export const holdingForearm: Pose = {
  ...sitKnees,
  armF: [[4, -16], [8, -30]],
  armN: [[-8, -18], [6, -23]],
};

// Lying on the back, head to the left.
export const lyingBack: Pose = {
  head: [-36, -8], neck: [-26, -6], hip: [0, -6],
  armN: [[-14, -1], [-3, 0]], armF: [[-14, -10], [-2, -10]],
  legN: [[17, -6], [33, -4]], legF: [[16, -9], [32, -9]],
};

// Lying on the back, awake, arms by the sides (under a jacket in "lying_awake").
export const lyingAwake: Pose = {
  ...lyingBack,
  armN: [[-14, -2], [-2, -2]], armF: [[-14, -10], [-2, -10]],
};

// Lying on the back, arms and legs slightly bent (seizure).
export const lyingJerk: Pose = {
  ...lyingBack,
  armN: [[-16, -3], [-10, -13]], armF: [[-12, -10], [-6, -2]],
  legN: [[16, -10], [30, -2]], legF: [[18, -5], [34, -9]],
};

// Recovery position: on the side, top leg bent, top arm across.
export const recoveryPose: Pose = {
  head: [-36, -9], neck: [-26, -7], hip: [0, -6],
  armN: [[-18, -14], [-30, -12]], armF: [[-16, -4], [-31, -3]],
  legN: [[14, -17], [26, -5]], legF: [[16, -5], [32, -3]],
};

// Rescuer kneeling, facing right.
export const kneel: Pose = {
  head: [0, -53], neck: [-1, -42], hip: [-4, -18],
  armN: [[8, -34], [19, -27]], armF: [[9, -33], [19, -26]],
  legN: [[8, -3], [-8, -2]], legF: [[7, -5], [-9, -3]],
};

// Kneeling, straight arms, hands on the centre of the chest (CPR).
export const kneelCpr: Pose = {
  head: [4, -54], neck: [0, -43], hip: [-8, -17],
  armN: [[0, -27], [0, -12.5]], armF: [[1, -27], [1, -12.5]],
  legN: [[6, -3], [-10, -2]], legF: [[5, -5], [-11, -3]],
};

// Pointing / explaining to someone on the right.
export const pointing: Pose = {
  ...stand,
  armN: [[10, -47], [22, -44]],
};

// Forearm held out under a running tap.
export const underTap: Pose = {
  ...stand,
  armN: [[8, -42], [20, -38]],
};

// Child holding a forearm with the other hand.
export const holdingForearmStanding: Pose = {
  ...stand,
  armF: [[9, -41], [16, -52]],
  armN: [[-1, -41], [12, -46]],
};
