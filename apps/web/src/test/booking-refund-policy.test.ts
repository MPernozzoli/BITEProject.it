import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { refundPolicyPercent, resolveRefundPercent } from "@/server/bunq/refunds";

const booking = {
  id: "booking-1",
  profile_id: "profile-1",
  voyage_id: "voyage-1",
  status: "user_confirmed",
  plan_change_status: "pending_user_approval",
};

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

/**
 * Minimal stand-in for the query builder: every chained call returns the same object, and awaiting
 * it (or calling maybeSingle) yields the row configured for the table that started the chain.
 */
function fakeDb(rowsByTable: Record<string, unknown>): SupabaseClient {
  const client = {
    from(table: string) {
      const result = { data: rowsByTable[table] ?? null, error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => result,
        then: (resolve: (value: unknown) => unknown) => resolve(result),
      };
      return chain;
    },
  };
  return client as unknown as SupabaseClient;
}

/** A booking departing in `days`, whose latest plan change was (or was not) force majeure. */
function dbFor(days: number, forceMajeure: boolean | undefined) {
  return fakeDb({
    voyage_booking_request_legs: [
      { voyage_bookable_legs: { starts_at_window_start: inDays(days), starts_at_window_end: null } },
    ],
    voyage_booking_plan_changes:
      forceMajeure === undefined ? null : { metadata: { force_majeure: forceMajeure } },
  });
}

describe("refund policy", () => {
  describe("traveller withdrawal", () => {
    it("refunds in full more than 30 days before departure", async () => {
      expect(await refundPolicyPercent(dbFor(45, undefined), booking, "user_cancelled")).toBe(100);
    });

    it("refunds half between 15 and 30 days", async () => {
      expect(await refundPolicyPercent(dbFor(20, undefined), booking, "user_cancelled")).toBe(50);
    });

    it("refunds nothing under 15 days", async () => {
      expect(await refundPolicyPercent(dbFor(5, undefined), booking, "user_cancelled")).toBe(0);
    });
  });

  describe("cancelled by us", () => {
    it("refunds in full regardless of how close departure is", async () => {
      expect(await refundPolicyPercent(dbFor(1, undefined), booking, "admin_cancelled")).toBe(100);
      expect(await refundPolicyPercent(dbFor(1, undefined), booking, "admin_rejected")).toBe(100);
    });
  });

  describe("declined plan change", () => {
    it("follows the withdrawal tiers when the change was force majeure", async () => {
      expect(await refundPolicyPercent(dbFor(45, true), booking, "admin_plan_change_declined")).toBe(100);
      expect(await refundPolicyPercent(dbFor(20, true), booking, "admin_plan_change_declined")).toBe(50);
      expect(await refundPolicyPercent(dbFor(5, true), booking, "admin_plan_change_declined")).toBe(0);
    });

    it("refunds in full when the change was on us", async () => {
      expect(await refundPolicyPercent(dbFor(5, false), booking, "admin_plan_change_declined")).toBe(100);
    });

    it("refunds in full when the reason is unknown, so a missing flag never costs the traveller", async () => {
      expect(await refundPolicyPercent(dbFor(5, undefined), booking, "admin_plan_change_declined")).toBe(100);
    });
  });

  describe("admin override", () => {
    it("raises the refund above the policy", async () => {
      const db = dbFor(5, true);
      expect(await resolveRefundPercent(db, booking, "admin_plan_change_declined", 100)).toBe(100);
    });

    it("ignores an override that would pay less than the Terms promise", async () => {
      const db = dbFor(45, undefined);
      expect(await resolveRefundPercent(db, booking, "user_cancelled", 10)).toBe(100);
    });

    it("falls back to the policy when no override is given", async () => {
      const db = dbFor(20, undefined);
      expect(await resolveRefundPercent(db, booking, "user_cancelled", null)).toBe(50);
      expect(await resolveRefundPercent(db, booking, "user_cancelled", Number.NaN)).toBe(50);
    });

    it("never exceeds 100%", async () => {
      const db = dbFor(5, true);
      expect(await resolveRefundPercent(db, booking, "admin_plan_change_declined", 500)).toBe(100);
    });
  });
});
