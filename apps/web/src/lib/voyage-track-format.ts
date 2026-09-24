/** Shared display helpers of the admin track pages (colours per leg, Europe/Rome times). */
export const SEGMENT_COLORS = [
  "hsl(24,88%,52%)",
  "hsl(200,80%,42%)",
  "hsl(152,60%,36%)",
  "hsl(280,55%,52%)",
  "hsl(45,90%,42%)",
  "hsl(340,70%,50%)",
  "hsl(180,60%,33%)",
  "hsl(230,60%,55%)",
];
const UNASSIGNED_COLOR = "hsl(0,0%,40%)";
export const colorForLeg = (legIndex: number | null) => (legIndex === null ? UNASSIGNED_COLOR : SEGMENT_COLORS[legIndex % SEGMENT_COLORS.length]);

export const formatRomeTime = (ms: number | null | undefined) =>
  ms == null
    ? "—"
    : new Date(ms).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
