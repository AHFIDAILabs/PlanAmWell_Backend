const raw = Number(process.env.CALL_GRACE_MINUTES ?? 10);

export const CALL_GRACE_MINUTES = Math.min(
  Math.max(raw, 1),   // at least 1 min
  30                 // at most 30 mins
);

