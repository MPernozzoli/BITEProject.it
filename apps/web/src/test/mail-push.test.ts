import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveMailAssignment, resolveMailPushRevocationProfileIds } from "@/server/mail-push";

type QueryCall = {
  table: string;
  select?: string;
};

function createMailDbMock() {
  const calls: QueryCall[] = [];

  return {
    calls,
    db: {
      rpc: async (name: string) => {
        expect(name).toBe("refresh_admin_email_aliases");
        return { error: null };
      },
      from: (table: string) => ({
        select: (select: string) => {
          calls.push({ table, select });

          if (table === "user_roles") {
            return {
              eq: async (_column: string, value: string) => {
                expect(value).toBe("admin");
                return {
                  data: [
                    { user_id: "admin-1" },
                    { user_id: "admin-2" },
                  ],
                  error: null,
                };
              },
            };
          }

          if (table === "profiles") {
            return {
              in: async (_column: string, ids: string[]) => ({
                data: ids.map((id) => ({ id, email: `${id}@biteproject.it`, name: id })),
                error: null,
              }),
            };
          }

          if (table === "admin_email_aliases") {
            return {
              in: async (_column: string, aliases: string[]) => ({
                data: aliases.includes("admin-1") ? [{ profile_id: "admin-1", alias: "admin-1" }] : [],
                error: null,
              }),
            };
          }

          throw new Error(`Unexpected table ${table}`);
        },
      }),
    },
  };
}

describe("resolveMailAssignment", () => {
  it("loads admin profiles without relying on a PostgREST relationship from user_roles", async () => {
    const { db, calls } = createMailDbMock();

    const assignment = await resolveMailAssignment(db as unknown as SupabaseClient, ["admin-1@biteproject.it"]);

    expect(assignment).toEqual({
      assignedProfileId: "admin-1",
      notifyProfileIds: ["admin-1"],
      reason: "alias_match",
    });
    expect(calls).toContainEqual({ table: "user_roles", select: "user_id" });
    expect(calls.some((call) => call.table === "user_roles" && call.select?.includes("profiles"))).toBe(false);
    expect(calls).toContainEqual({ table: "profiles", select: "id,email,name" });
  });
});

describe("resolveMailPushRevocationProfileIds", () => {
  it("targets only the assigned admin for alias-matched mail", async () => {
    const { db } = createMailDbMock();

    const profileIds = await resolveMailPushRevocationProfileIds(db as unknown as SupabaseClient, {
      id: "message-1",
      assigned_to_profile_id: "admin-1",
      assignment_reason: "alias_match",
      push_notified_at: "2026-07-16T10:00:00.000Z",
    });

    expect(profileIds).toEqual(["admin-1"]);
  });

  it("targets every admin when the original mail notification was broadcast", async () => {
    const { db } = createMailDbMock();

    const profileIds = await resolveMailPushRevocationProfileIds(db as unknown as SupabaseClient, {
      id: "message-2",
      assigned_to_profile_id: null,
      assignment_reason: "fallback_all_admins",
      push_notified_at: "2026-07-16T10:00:00.000Z",
    });

    expect(profileIds).toEqual(["admin-1", "admin-2"]);
  });
});
