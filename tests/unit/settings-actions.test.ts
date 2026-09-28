import { beforeEach, describe, expect, it, vi } from "vitest";
import * as actions from "@/app/app/settings/actions";
import * as settings from "@/lib/clinic-settings";
import { requireOwner, requireStaff } from "@/lib/supabase/server";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/push", () => ({ saveSubscription: vi.fn(), deleteSubscription: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ OWNER_ONLY: "Only the clinic's owner can change this.", requireStaff: vi.fn(), requireOwner: vi.fn() }));
vi.mock("@/lib/clinic-settings", () => {
  const saved = async () => ({ ok: true });
  return {
    saveProfile: vi.fn(saved),
    saveRules: vi.fn(saved),
    saveDentist: vi.fn(saved),
    setDentistActive: vi.fn(saved),
    addTimeOff: vi.fn(saved),
    removeTimeOff: vi.fn(saved),
    saveProcedure: vi.fn(saved),
    setProcedureActive: vi.fn(saved),
    saveBranch: vi.fn(saved),
    setBranchActive: vi.fn(saved),
    moveBranch: vi.fn(saved),
  };
});

const ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const member = (role: "owner" | "staff") => ({ db: {} as never, userId: "u1", clinicId: "c1", role });

// Every owner-only setting (teams spec 4), called the way the Settings forms call them.
const ownerOnly = () => [
  actions.updateProfile({}),
  actions.updateRules({}),
  actions.saveDentistAction(null, {}),
  actions.setDentistActiveAction(ID, false),
  actions.saveProcedureAction(null, {}),
  actions.setProcedureActiveAction(ID, false),
  actions.saveBranchAction(null, {}),
  actions.setBranchActiveAction(ID, false),
  actions.moveBranchAction(ID, "up"),
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("settings actions", () => {
  it("answer staff that only the owner changes the clinic's setup, and save nothing", async () => {
    vi.mocked(requireStaff).mockResolvedValue(member("staff"));
    vi.mocked(requireOwner).mockResolvedValue(null);
    for (const result of await Promise.all(ownerOnly())) expect(result).toEqual({ ok: false, error: "Only the clinic's owner can change this." });
    for (const save of Object.values(settings)) expect(save).not.toHaveBeenCalled();
  });

  it("let staff add and remove dentists' time off", async () => {
    vi.mocked(requireStaff).mockResolvedValue(member("staff"));
    vi.mocked(requireOwner).mockResolvedValue(null);
    expect(await actions.addTimeOffAction(ID, {})).toEqual({ ok: true });
    expect(await actions.removeTimeOffAction(ID)).toEqual({ ok: true });
    expect(settings.addTimeOff).toHaveBeenCalledOnce();
    expect(settings.removeTimeOff).toHaveBeenCalledOnce();
  });

  it("let the owner change the setup", async () => {
    vi.mocked(requireStaff).mockResolvedValue(member("owner"));
    vi.mocked(requireOwner).mockResolvedValue(member("owner"));
    for (const result of await Promise.all(ownerOnly())) expect(result).toEqual({ ok: true });
    expect(settings.saveProfile).toHaveBeenCalledOnce();
    expect(settings.setProcedureActive).toHaveBeenCalledOnce();
    expect(settings.moveBranch).toHaveBeenCalledWith(member("owner"), ID, "up");
  });
});
