import { hashPassword } from "better-auth/crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  appointmentProcedures,
  appointments,
  branches,
  chairs,
  dentistSchedules,
  patients,
  practice,
  procedures,
  userBranches,
  users,
} from "@/db/schema";
import { DEFAULT_HOURS } from "@/lib/hours";
import type { Status } from "@/lib/lifecycle";
import type { Role } from "@/lib/permissions";
import { addDays, manilaDate, manilaInstant, toMinutes, weekday } from "@/lib/time";
import { randomToken } from "@/lib/tokens";
import { createCredentialUser } from "./accounts";

const BRANCHES = [
  { code: "downtown", name: "Downtown", chairs: ["General", "General", "Ortho", "Surgery"] },
  { code: "westside", name: "Westside", chairs: ["General", "General", "Ortho"] },
  { code: "metro-north", name: "Metro North", chairs: ["General", "General", "Pedo"] },
];

/** Spec 15's placeholders, for the dentists to correct: name, minutes, turnover minutes. */
const PROCEDURES: [string, number, number][] = [
  ["Consultation", 30, 10],
  ["Oral prophylaxis", 45, 15],
  ["Tooth filling", 60, 15],
  ["Tooth extraction", 45, 20],
  ["Root canal treatment", 90, 20],
  ["Orthodontic adjustment", 30, 10],
  ["Fluoride application", 30, 10],
];

const MON_SAT = [1, 2, 3, 4, 5, 6];
const MON_FRI = [1, 2, 3, 4, 5];

/** A weekly block: branch code, weekdays, start, end. */
type Block = [string, number[], string, string];
type Person = { name: string; username: string; role: Role; title: string | null; branch?: string; blocks?: Block[] };

/** An owner who sees patients, a front desk per branch, and 5 dentists (one a hygienist) with split days. */
const STAFF: Person[] = [
  { name: "Dr. Maria Santos", username: "owner", role: "owner", title: "Dentist", blocks: [["downtown", MON_FRI, "13:00", "18:00"]] },
  { name: "Liza Ramos", username: "downtown.desk", role: "manager", title: null, branch: "downtown" },
  { name: "Joy Mendoza", username: "westside.desk", role: "manager", title: null, branch: "westside" },
  { name: "Carlo Dizon", username: "metronorth.desk", role: "manager", title: null, branch: "metro-north" },
  {
    name: "Dr. Jose Reyes",
    username: "dr.reyes",
    role: "dentist",
    title: "Dentist",
    blocks: [
      ["downtown", MON_SAT, "09:00", "12:00"],
      ["metro-north", MON_SAT, "13:00", "18:00"],
    ],
  },
  { name: "Dr. Ana Cruz", username: "dr.cruz", role: "dentist", title: "Dentist", blocks: [["westside", MON_FRI, "09:00", "18:00"]] },
  {
    name: "Dr. Paolo Garcia",
    username: "dr.garcia",
    role: "dentist",
    title: "Orthodontist",
    blocks: [
      ["downtown", [1, 3, 5], "09:00", "18:00"],
      ["westside", [2, 4], "09:00", "18:00"],
    ],
  },
  {
    name: "Dr. Bea Villanueva",
    username: "dr.villanueva",
    role: "dentist",
    title: "Oral surgeon",
    blocks: [
      ["metro-north", [1, 3, 5], "09:00", "12:00"],
      ["downtown", [2, 4, 6], "13:00", "18:00"],
    ],
  },
  { name: "Kim Lim", username: "hyg.lim", role: "dentist", title: "Hygienist", blocks: [["metro-north", MON_SAT, "09:00", "18:00"]] },
];

// Even positions are women's names and odd positions men's, so a patient's sex follows their index.
const FIRST = ["Ana", "Jose", "Maria", "Juan", "Rosa", "Pedro", "Liza", "Mark", "Grace", "Paolo", "Joy", "Carlo", "Bea", "Miguel", "Andrea", "Rafael", "Nina", "Luis", "Carmen", "Ramon"];
const LAST = ["Santos", "Reyes", "Cruz", "Bautista", "Garcia", "Mendoza", "Torres", "Flores", "Ramos", "Aquino", "Castillo", "Villanueva", "Dizon", "Navarro", "Salazar", "Rivera", "Domingo", "Soriano", "Pascual", "Mercado"];

/** A small seeded random generator (mulberry32), so the same `now` always gives the same data. */
function randomFrom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMPLETED: Status[] = ["checked_in", "in_treatment", "completed"];

type Planned = {
  branchId: string;
  chairNumber: number;
  dentistId: string;
  patientId: string;
  start: Date;
  end: Date;
  chairFreeAt: Date;
  procedure: { id: string; name: string; durationMinutes: number; bufferMinutes: number };
  status: "requested" | "confirmed";
  path: Status[];
};

/** Spec 15: fills an empty database with a practice to try things on. Returns the one password every account uses. */
export async function seed(now = new Date()): Promise<{ password: string; accounts: string[] }> {
  const [existing] = await db.select({ id: users.id }).from(users).limit(1);
  if (existing) throw new Error("This database already has data. To start over, delete its folder (.data/dev by default) and run npm run seed again.");
  const password = randomToken(12);
  const passwordHash = await hashPassword(password);
  const random = randomFrom(20261005);

  await db.transaction(async (tx) => {
    await tx.insert(practice).values({ name: "Sample Dental Group" });
    const branchRows = await tx
      .insert(branches)
      .values(BRANCHES.map((b, sort) => ({ code: b.code, name: b.name, operatingHours: DEFAULT_HOURS, joinCode: randomToken(16), sort })))
      .returning({ id: branches.id, code: branches.code });
    const branchId = (code: string) => branchRows.find((b) => b.code === code)!.id;
    await tx.insert(chairs).values(BRANCHES.flatMap((b) => b.chairs.map((label, i) => ({ branchId: branchId(b.code), number: i + 1, label }))));
    const procedureRows = await tx
      .insert(procedures)
      .values(PROCEDURES.map(([name, durationMinutes, bufferMinutes], sort) => ({ name, durationMinutes, bufferMinutes, sort })))
      .returning();

    let ownerId = "";
    const people: { id: string; person: Person }[] = [];
    for (const person of STAFF) {
      const codes = person.branch ? [person.branch] : [...new Set((person.blocks ?? []).map(([code]) => code))];
      const user = await createCredentialUser(
        {
          name: person.name,
          username: person.username,
          role: person.role,
          status: "active",
          seesPatients: person.role !== "manager",
          title: person.title,
          primaryBranchId: person.role === "owner" ? null : branchId(codes[0]),
        },
        passwordHash,
        tx,
      );
      if (person.role === "owner") ownerId = user.id;
      else {
        await tx.update(users).set({ approvedBy: ownerId, approvedAt: now }).where(eq(users.id, user.id));
        await tx.insert(userBranches).values(codes.map((code) => ({ userId: user.id, branchId: branchId(code) })));
      }
      people.push({ id: user.id, person });
    }
    const blocks = people.flatMap(({ id, person }) =>
      (person.blocks ?? []).flatMap(([code, days, startTime, endTime]) =>
        days.map((dayOfWeek) => ({ dentistId: id, branchId: branchId(code), dayOfWeek, startTime, endTime })),
      ),
    );
    await tx.insert(dentistSchedules).values(blocks);

    const patientRows = await tx
      .insert(patients)
      .values(
        Array.from({ length: 40 }, (_, i) => {
          const born = 1955 + Math.floor(random() * 65);
          return {
            lastName: LAST[(i * 7 + Math.floor(i / 20)) % 20],
            firstName: FIRST[i % 20],
            birthday: `${born}-${String(1 + Math.floor(random() * 12)).padStart(2, "0")}-${String(1 + Math.floor(random() * 28)).padStart(2, "0")}`,
            sex: i % 2 === 0 ? "female" : "male",
            mobile: `+63917${String(1_000_000 + i * 104_729).slice(-7)}`,
            guardianName: born >= 2010 ? `${FIRST[(i + 2) % 20]} ${LAST[(i * 7) % 20]}` : null,
            hmoProvider: i % 4 === 0 ? "Sample HMO" : null,
            hmoMemberNo: i % 4 === 0 ? `SH-${1000 + i}` : null,
            allergies: i % 9 === 0 ? ["penicillin"] : i % 13 === 5 ? ["latex"] : [],
            medicalAlerts: i % 6 === 2 ? "Hypertension, on maintenance medicine" : i % 11 === 4 ? "Diabetic" : "",
            consentAt: now,
            consentBy: ownerId,
            homeBranchId: branchRows[i % 3].id,
            createdBy: ownerId,
            updatedBy: ownerId,
          };
        }),
      )
      .returning({ id: patients.id });

    // Two weeks of visits: each dentist's blocks filled in order with a random procedure, a free chair (turnover
    // included), and a patient not yet seen that day, so nothing overlaps.
    const today = manilaDate(now);
    const planned: Planned[] = [];
    for (let offset = -7; offset <= 7; offset += 1) {
      const date = addDays(today, offset);
      const unused = patientRows.map((p) => p.id).sort(() => random() - 0.5);
      for (const branch of branchRows) {
        const chairNumbers = BRANCHES.find((b) => b.code === branch.code)!.chairs.map((_, i) => i + 1);
        const freeAt = new Map<number, number>();
        const todays = blocks.filter((b) => b.branchId === branch.id && b.dayOfWeek === weekday(date));
        for (const block of todays) {
          const nextOf: Planned[] = [];
          for (let t = toMinutes(block.startTime); t < toMinutes(block.endTime); ) {
            // About a third of the day stays open, in gaps of 15 to 45 minutes, so there is room to book.
            if (random() < 0.35) {
              t += 15 * (1 + Math.floor(random() * 3));
              continue;
            }
            const procedure = procedureRows[Math.floor(random() * procedureRows.length)];
            if (t + procedure.durationMinutes > toMinutes(block.endTime)) break;
            const chairNumber = chairNumbers.find((n) => (freeAt.get(n) ?? 0) <= t);
            if (chairNumber === undefined) {
              t += 15;
              continue;
            }
            const patientId = unused.pop();
            if (patientId === undefined) break;
            freeAt.set(chairNumber, t + procedure.durationMinutes + procedure.bufferMinutes);
            const start = manilaInstant(date, t);
            const end = manilaInstant(date, t + procedure.durationMinutes);
            const visit: Planned = {
              branchId: branch.id,
              chairNumber,
              dentistId: block.dentistId,
              patientId,
              start,
              end,
              chairFreeAt: manilaInstant(date, t + procedure.durationMinutes + procedure.bufferMinutes),
              procedure,
              status: "confirmed",
              path: [],
            };
            const roll = random();
            if (offset < 0) visit.path = roll < 0.7 ? COMPLETED : roll < 0.85 ? ["no_show"] : ["cancelled"];
            else if (offset > 0) {
              if (roll < 0.2) visit.status = "requested";
              else if (roll < 0.25) visit.path = ["cancelled"];
            } else if (end <= now) visit.path = roll < 0.9 ? COMPLETED : ["no_show"];
            else if (start <= now) visit.path = ["checked_in", "in_treatment"];
            else nextOf.push(visit);
            planned.push(visit);
            t += procedure.durationMinutes;
          }
          // The dentist's next patient today, if due within the hour, is already in the waiting room.
          const next = nextOf[0];
          if (next && next.start.getTime() - now.getTime() <= 3_600_000) next.path = ["checked_in"];
        }
      }
    }

    const saved = await tx
      .insert(appointments)
      .values(
        planned.map((v) => ({
          patientId: v.patientId,
          dentistId: v.dentistId,
          branchId: v.branchId,
          chairNumber: v.chairNumber,
          startTime: v.start,
          endTime: v.end,
          chairFreeAt: v.chairFreeAt,
          status: v.status,
          source: "staff",
          createdBy: ownerId,
        })),
      )
      .returning({ id: appointments.id });
    await tx.insert(appointmentProcedures).values(
      planned.map((v, i) => ({
        appointmentId: saved[i].id,
        position: 0,
        procedureId: v.procedure.id,
        name: v.procedure.name,
        durationMinutes: v.procedure.durationMinutes,
        bufferMinutes: v.procedure.bufferMinutes,
      })),
    );
    // Real status changes, one step at a time, so the lifecycle trigger checks each one and stamps its time.
    for (let step = 0; step < COMPLETED.length; step += 1) {
      for (const status of new Set(planned.map((v) => v.path[step]).filter(Boolean))) {
        const ids = saved.filter((_, i) => planned[i].path[step] === status).map((s) => s.id);
        await tx
          .update(appointments)
          .set({ status, ...(status === "cancelled" ? { cancelReason: "Asked to move to another day" } : {}) })
          .where(inArray(appointments.id, ids));
      }
    }
  });

  return {
    password,
    accounts: STAFF.map((p) => {
      const role = p.role === "owner" ? "owner" : p.role === "manager" ? `front desk at ${p.branch}` : p.title;
      return `${p.username.padEnd(16)} ${p.name}, ${role}`;
    }),
  };
}
