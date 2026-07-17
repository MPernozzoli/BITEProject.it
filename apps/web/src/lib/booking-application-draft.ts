import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { emptyCandidateInfo, normalizeCandidateInfo, type CandidateInfo } from "@/lib/booking-candidate-info";

const LOCAL_DRAFTS_KEY = "bite_voyage_booking_drafts";
const DRAFT_VERSION = 1;

export type BookingApplicationDraft = {
  version: number;
  voyageId: string;
  selectedLegIds: string[];
  partySize: string;
  message: string;
  candidateInfo: CandidateInfo;
  updatedAt: string;
};

type StoredDraftMap = Record<string, BookingApplicationDraft>;

type CloudDraftRow = {
  voyage_id: string;
  leg_ids: string[] | null;
  party_size: number | null;
  message: string | null;
  candidate_info: Partial<CandidateInfo> | null;
  updated_at: string;
};

type CloudDraftInsert = Database["public"]["Tables"]["voyage_booking_drafts"]["Insert"];

const readLocalDrafts = (): StoredDraftMap => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_DRAFTS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as StoredDraftMap) : {};
  } catch {
    return {};
  }
};

const writeLocalDrafts = (drafts: StoredDraftMap) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_DRAFTS_KEY, JSON.stringify(drafts));
};

export const buildBookingApplicationDraft = (params: {
  voyageId: string;
  selectedLegIds: string[];
  partySize: string;
  message: string;
  candidateInfo: CandidateInfo;
}): BookingApplicationDraft => ({
  version: DRAFT_VERSION,
  voyageId: params.voyageId,
  selectedLegIds: params.selectedLegIds,
  partySize: params.partySize,
  message: params.message,
  candidateInfo: normalizeCandidateInfo(params.candidateInfo),
  updatedAt: new Date().toISOString(),
});

export const isBookingApplicationDraftEmpty = (draft: Pick<BookingApplicationDraft, "selectedLegIds" | "partySize" | "message" | "candidateInfo">) => {
  const normalizedInfo = normalizeCandidateInfo(draft.candidateInfo);
  return (
    draft.selectedLegIds.length === 0 &&
    (draft.partySize.trim() === "" || draft.partySize.trim() === "1") &&
    draft.message.trim() === "" &&
    JSON.stringify(normalizedInfo) === JSON.stringify(emptyCandidateInfo)
  );
};

export const getLocalBookingApplicationDraft = (voyageId: string) => readLocalDrafts()[voyageId] || null;

export const saveLocalBookingApplicationDraft = (draft: BookingApplicationDraft) => {
  const drafts = readLocalDrafts();
  drafts[draft.voyageId] = draft;
  writeLocalDrafts(drafts);
};

export const clearLocalBookingApplicationDraft = (voyageId: string) => {
  const drafts = readLocalDrafts();
  delete drafts[voyageId];
  writeLocalDrafts(drafts);
};

const cloudRowToDraft = (row: CloudDraftRow): BookingApplicationDraft => ({
  version: DRAFT_VERSION,
  voyageId: row.voyage_id,
  selectedLegIds: Array.isArray(row.leg_ids) ? row.leg_ids : [],
  partySize: String(Math.max(1, row.party_size || 1)),
  message: row.message || "",
  candidateInfo: normalizeCandidateInfo(row.candidate_info),
  updatedAt: row.updated_at,
});

const newerDraft = (first: BookingApplicationDraft | null, second: BookingApplicationDraft | null) => {
  if (!first) return second;
  if (!second) return first;
  return Date.parse(first.updatedAt) >= Date.parse(second.updatedAt) ? first : second;
};

export async function loadBookingApplicationDraft(voyageId: string, userId?: string | null) {
  const localDraft = getLocalBookingApplicationDraft(voyageId);
  if (!userId) return localDraft;

  const { data, error } = await supabase
    .from("voyage_booking_drafts")
    .select("voyage_id,leg_ids,party_size,message,candidate_info,updated_at")
    .eq("profile_id", userId)
    .eq("voyage_id", voyageId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load cloud booking draft", error);
    return localDraft;
  }

  return newerDraft(localDraft, data ? cloudRowToDraft(data as CloudDraftRow) : null);
}

export async function saveCloudBookingApplicationDraft(userId: string, draft: BookingApplicationDraft) {
  const partySize = Math.max(1, Number.parseInt(draft.partySize, 10) || 1);
  const values: CloudDraftInsert = {
    profile_id: userId,
    voyage_id: draft.voyageId,
    leg_ids: draft.selectedLegIds,
    party_size: partySize,
    message: draft.message.trim() || null,
    candidate_info: draft.candidateInfo,
    updated_at: draft.updatedAt,
  };
  const { error } = await supabase
    .from("voyage_booking_drafts")
    .upsert(values, { onConflict: "profile_id,voyage_id" });

  if (error) throw new Error(error.message || "booking_draft_save_failed");
}

export async function clearCloudBookingApplicationDraft(userId: string, voyageId: string) {
  const { error } = await supabase
    .from("voyage_booking_drafts")
    .delete()
    .eq("profile_id", userId)
    .eq("voyage_id", voyageId);

  if (error) throw new Error(error.message || "booking_draft_clear_failed");
}
