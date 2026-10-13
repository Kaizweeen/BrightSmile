import { describe, expect, it } from "vitest";
import { can, covers, type Subject } from "@/lib/permissions";

const DT = "downtown-id";
const WS = "westside-id";
const MN = "metro-id";
const owner: Subject = { id: "owner", role: "owner", seesPatients: false, branchIds: [DT, WS, MN] };
const ownerWhoTreats: Subject = { ...owner, id: "owner-dentist", seesPatients: true };
const manager: Subject = { id: "mgr", role: "manager", seesPatients: false, branchIds: [DT] };
const twoBranchManager: Subject = { id: "mgr2", role: "manager", seesPatients: false, branchIds: [DT, WS] };
const dentist: Subject = { id: "dr", role: "dentist", seesPatients: true, branchIds: [DT, WS] };

describe("covers", () => {
  it("covers every branch for the owner and the listed ones for others", () => {
    expect(covers(owner, "any-branch")).toBe(true);
    expect(covers(manager, DT)).toBe(true);
    expect(covers(manager, WS)).toBe(false);
  });
});

describe("calendar and visits", () => {
  it("shows a branch's calendar to the people who cover it, and a dentist their own visits anywhere", () => {
    expect(can(owner, "calendar.view", { branchId: MN })).toBe(true);
    expect(can(manager, "calendar.view", { branchId: DT })).toBe(true);
    expect(can(manager, "calendar.view", { branchId: WS })).toBe(false);
    expect(can(dentist, "calendar.view", { branchId: WS })).toBe(true);
    expect(can(dentist, "calendar.view", { branchId: MN })).toBe(false);
    expect(can(dentist, "calendar.view", { branchId: MN, dentistId: "dr" })).toBe(true);
    expect(can(dentist, "calendar.view", { branchId: MN, dentistId: "someone-else" })).toBe(false);
  });

  it("lets the owner and the branch's managers book and manage visits", () => {
    for (const action of ["appointment.book", "appointment.manage"] as const) {
      expect(can(owner, action, { branchId: MN })).toBe(true);
      expect(can(manager, action, { branchId: DT })).toBe(true);
      expect(can(manager, action, { branchId: WS })).toBe(false);
      expect(can(dentist, action, { branchId: DT })).toBe(false);
    }
  });

  it("lets dentists start and complete only their own visits", () => {
    expect(can(owner, "appointment.treat", { branchId: MN, dentistId: "someone-else" })).toBe(true);
    expect(can(dentist, "appointment.treat", { branchId: DT, dentistId: "dr" })).toBe(true);
    expect(can(dentist, "appointment.treat", { branchId: DT, dentistId: "someone-else" })).toBe(false);
    expect(can(manager, "appointment.treat", { branchId: DT, dentistId: "someone-else" })).toBe(true);
    expect(can(manager, "appointment.treat", { branchId: WS, dentistId: "someone-else" })).toBe(false);
  });
});

describe("patients and clinical records", () => {
  it("lets everyone read patients and clinical records, and edit allergies and alerts", () => {
    for (const s of [owner, manager, dentist]) {
      expect(can(s, "patient.view")).toBe(true);
      expect(can(s, "clinical.read")).toBe(true);
      expect(can(s, "patient.editAlerts")).toBe(true);
    }
  });

  it("lets only the owner and managers edit patient details", () => {
    expect(can(owner, "patient.edit")).toBe(true);
    expect(can(manager, "patient.edit")).toBe(true);
    expect(can(dentist, "patient.edit")).toBe(false);
  });

  it("lets dentists write clinical records on their own visits or with no visit", () => {
    expect(can(dentist, "clinical.write", { dentistId: "dr" })).toBe(true);
    expect(can(dentist, "clinical.write", {})).toBe(true);
    expect(can(dentist, "clinical.write", { dentistId: "someone-else" })).toBe(false);
    expect(can(manager, "clinical.write", { dentistId: null })).toBe(false);
    expect(can(owner, "clinical.write", { dentistId: "someone-else" })).toBe(false);
    expect(can(ownerWhoTreats, "clinical.write", { dentistId: "someone-else" })).toBe(true);
  });
});

describe("schedules", () => {
  const drTarget = { dentistId: "dr", branchIds: [DT, WS] };

  it("shows a schedule to the owner, managers who share a branch, and the dentist", () => {
    expect(can(owner, "schedule.view", drTarget)).toBe(true);
    expect(can(manager, "schedule.view", drTarget)).toBe(true);
    expect(can(manager, "schedule.view", { dentistId: "x", branchIds: [MN] })).toBe(false);
    expect(can(dentist, "schedule.view", drTarget)).toBe(true);
    expect(can(dentist, "schedule.view", { dentistId: "x", branchIds: [DT] })).toBe(false);
  });

  it("lets the owner and those managers edit it, never the dentist", () => {
    expect(can(owner, "schedule.edit", drTarget)).toBe(true);
    expect(can(manager, "schedule.edit", drTarget)).toBe(true);
    expect(can(manager, "schedule.edit", { dentistId: "x", branchIds: [MN] })).toBe(false);
    expect(can(dentist, "schedule.edit", drTarget)).toBe(false);
  });
});

describe("staff", () => {
  it("shows staff to the owner and managers", () => {
    expect(can(owner, "staff.view")).toBe(true);
    expect(can(manager, "staff.view")).toBe(true);
    expect(can(dentist, "staff.view")).toBe(false);
  });

  it("lets managers approve requests for their branches only", () => {
    expect(can(owner, "staff.approve", { branchId: MN })).toBe(true);
    expect(can(manager, "staff.approve", { branchId: DT })).toBe(true);
    expect(can(manager, "staff.approve", { branchId: WS })).toBe(false);
    expect(can(dentist, "staff.approve", { branchId: DT })).toBe(false);
  });

  it("lets managers manage non-owner staff who share a branch, and nobody manage themselves", () => {
    expect(can(manager, "staff.manage", { userId: "dr", userRole: "dentist", branchIds: [DT, WS] })).toBe(true);
    expect(can(manager, "staff.manage", { userId: "x", userRole: "dentist", branchIds: [MN] })).toBe(false);
    expect(can(manager, "staff.manage", { userId: "owner", userRole: "owner", branchIds: [DT] })).toBe(false);
    expect(can(manager, "staff.manage", { userId: "mgr", userRole: "manager", branchIds: [DT] })).toBe(false);
    expect(can(owner, "staff.manage", { userId: "mgr", userRole: "manager", branchIds: [DT] })).toBe(true);
    expect(can(owner, "staff.manage", { userId: "owner", userRole: "owner" })).toBe(false);
    expect(can(dentist, "staff.manage", { userId: "x", userRole: "manager", branchIds: [DT] })).toBe(false);
  });
});

describe("owner-only areas", () => {
  it("keeps settings and the access log to the owner", () => {
    for (const action of ["settings.edit", "audit.view"] as const) {
      expect(can(owner, action)).toBe(true);
      expect(can(twoBranchManager, action)).toBe(false);
      expect(can(dentist, action)).toBe(false);
    }
  });

  it("shows All branches to the owner and to managers of two or more branches", () => {
    expect(can(owner, "overview.view")).toBe(true);
    expect(can(manager, "overview.view")).toBe(false);
    expect(can(twoBranchManager, "overview.view")).toBe(true);
    expect(can(dentist, "overview.view")).toBe(false);
  });
});

describe("billing", () => {
  it("lets the owner and the branch's managers take payments, void and close, and never a dentist", () => {
    for (const action of ["billing.view", "billing.issue", "billing.void", "billing.close"] as const) {
      expect(can(owner, action, { branchId: MN })).toBe(true);
      expect(can(manager, action, { branchId: DT })).toBe(true);
      expect(can(manager, action, { branchId: WS })).toBe(false);
      expect(can(manager, action)).toBe(false);
      expect(can(dentist, action, { branchId: DT })).toBe(false);
    }
  });
});
