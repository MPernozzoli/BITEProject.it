/**
 * Tap-to-select model for the legs of a voyage.
 *
 * A booking always covers a contiguous run of legs, so the interaction mirrors a
 * date-range picker: the first tap picks the leg you board on, the second closes the
 * range on the leg you get off at, and everything in between comes along. A third tap
 * starts a new range, and tapping the single selected leg again clears the selection —
 * that is the undo everyone tries first.
 *
 * Kept out of the component because the desktop matrix and the mobile list must agree
 * on what a tap does, and because the rule is worth testing on its own.
 */

export interface LegSelection {
  legIds: string[];
  /** The leg the range is growing from; null once the range has been closed. */
  anchorLegId: string | null;
}

export const emptyLegSelection: LegSelection = { legIds: [], anchorLegId: null };

/** Where a leg sits inside the current selection, for badges and colouring. */
export type LegSelectionRole = "none" | "only" | "start" | "middle" | "end";

export function selectLegOnTap(
  orderedLegIds: string[],
  current: LegSelection,
  legId: string
): LegSelection {
  const index = orderedLegIds.indexOf(legId);
  if (index < 0) return current;

  // Tapping the one selected leg again clears everything.
  if (current.legIds.length === 1 && current.legIds[0] === legId) return emptyLegSelection;

  const anchorIndex = current.anchorLegId ? orderedLegIds.indexOf(current.anchorLegId) : -1;
  // No open range — nothing selected yet, or the previous range was already closed:
  // this tap opens a new one.
  if (anchorIndex < 0) return { legIds: [legId], anchorLegId: legId };

  const start = Math.min(anchorIndex, index);
  const end = Math.max(anchorIndex, index);
  return { legIds: orderedLegIds.slice(start, end + 1), anchorLegId: null };
}

/** Index range covered by a selection, or null when nothing is selected. */
export function getSelectionRange(
  orderedLegIds: string[],
  legIds: string[]
): { start: number; end: number } | null {
  const indices = legIds
    .map((id) => orderedLegIds.indexOf(id))
    .filter((index) => index >= 0);
  if (indices.length === 0) return null;
  return { start: Math.min(...indices), end: Math.max(...indices) };
}

export function getLegSelectionRole(
  index: number,
  range: { start: number; end: number } | null
): LegSelectionRole {
  if (!range || index < range.start || index > range.end) return "none";
  if (range.start === range.end) return "only";
  if (index === range.start) return "start";
  if (index === range.end) return "end";
  return "middle";
}

export function getLegSelectionRoleLabel(role: LegSelectionRole, lang: "it" | "en"): string | null {
  const it = lang === "it";
  switch (role) {
    case "only":
      return it ? "Imbarco e sbarco" : "Board and leave";
    case "start":
      return it ? "Imbarco" : "Board here";
    case "end":
      return it ? "Sbarco" : "Leave here";
    case "middle":
      return it ? "A bordo" : "On board";
    default:
      return null;
  }
}

/**
 * The one line of instructions shown above the legs, phrased for the step the traveller
 * is actually on. `anchorOpen` means a first leg was tapped and the range is still open.
 */
export function getLegSelectionHint(
  selectedCount: number,
  anchorOpen: boolean,
  lang: "it" | "en"
): string {
  const it = lang === "it";
  if (selectedCount === 0) {
    return it
      ? "Tocca qui sotto la tratta da cui vuoi imbarcarti."
      : "Tap below the leg you want to board on.";
  }
  if (anchorOpen) {
    return it
      ? "Ora tocca la tratta in cui vuoi sbarcare: prendiamo anche tutte quelle in mezzo. Se ti fermi qui, richiedi solo questa tratta."
      : "Now tap the leg you want to get off at — everything in between comes with it. Stop here to request just this one leg.";
  }
  return it
    ? "Tocca una tratta per ricominciare la scelta."
    : "Tap any leg to start the selection over.";
}
