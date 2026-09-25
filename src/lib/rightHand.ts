/** Right-hand arbitration in VR: whichever of drawing (trigger) or teleport (grip) starts first wins. */
export const rightHand: { mode: "idle" | "draw" | "teleport" } = { mode: "idle" };

/** Incremented each time a teleport has fully finished (after the fade-in). */
export const teleportEvents = { done: 0 };
