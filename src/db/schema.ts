import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const at = (name: string) => timestamp(name, { withTimezone: true });

/** Opening and closing time per weekday ("0" Sunday to "6" Saturday), or null when the branch is closed. */
export type OperatingHours = Record<string, { open: string; close: string } | null>;

/** The PDA exam sections: each marked item holds its detail (an empty string when there is none). */
export type ExamFindings = Record<string, Record<string, string>>;

export const practice = pgTable(
  "practice",
  {
    id: boolean("id").primaryKey().default(true),
    name: text("name").notNull(),
    visitMinutes: integer("visit_minutes").notNull().default(60),
    cleaningMinutes: integer("cleaning_minutes").notNull().default(10),
    onlineBooking: boolean("online_booking").notNull().default(false),
    patientForms: boolean("patient_forms").notNull().default(false),
    privacyNotice: text("privacy_notice").notNull().default(""),
    qrImage: text("qr_image"),
    createdAt: createdAt(),
  },
  (t) => [
    check("practice_one_row", sql`${t.id}`),
    check("practice_name", sql`char_length(${t.name}) between 1 and 80`),
    check("practice_visit_minutes", sql`${t.visitMinutes} between 15 and 240 and ${t.visitMinutes} % 15 = 0`),
    check("practice_cleaning_minutes", sql`${t.cleaningMinutes} between 0 and 60 and ${t.cleaningMinutes} % 5 = 0`),
    check("practice_privacy_notice", sql`char_length(${t.privacyNotice}) <= 5000`),
    check("practice_qr_image", sql`${t.qrImage} is null or (${t.qrImage} ~ '^data:image/(png|jpeg)\\u003bbase64,[A-Za-z0-9+/=]+$' and char_length(${t.qrImage}) <= 270000)`),
  ],
).enableRLS();

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    address: text("address").notNull().default(""),
    phone: text("phone").notNull().default(""),
    operatingHours: jsonb("operating_hours").$type<OperatingHours>().notNull(),
    joinCode: text("join_code").notNull().unique(),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check("branches_code", sql`${t.code} ~ '^[a-z0-9][a-z0-9-]{0,22}[a-z0-9]$' and ${t.code} <> 'all'`),
    check("branches_name", sql`char_length(${t.name}) between 1 and 40`),
    check("branches_address", sql`char_length(${t.address}) <= 200`),
    check("branches_phone", sql`char_length(${t.phone}) <= 20`),
    check("branches_hours", sql`jsonb_typeof(${t.operatingHours}) = 'object'`),
  ],
).enableRLS();

export const chairs = pgTable(
  "chairs",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    number: smallint("number").notNull(),
    label: text("label").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.number] }),
    check("chairs_number", sql`${t.number} between 1 and 99`),
    check("chairs_label", sql`char_length(${t.label}) <= 30`),
  ],
).enableRLS();

/** Better Auth's user table (its model "user"), plus DentaSync's staff columns. */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
    username: text("username").notNull().unique(),
    displayUsername: text("display_username"),
    role: text("role").notNull(),
    status: text("status").notNull(),
    title: text("title"),
    seesPatients: boolean("sees_patients").notNull().default(false),
    primaryBranchId: uuid("primary_branch_id").references(() => branches.id),
    requestedBranchId: uuid("requested_branch_id").references(() => branches.id),
    approvedBy: uuid("approved_by").references((): AnyPgColumn => users.id),
    approvedAt: at("approved_at"),
  },
  (t) => [
    check("users_role", sql`${t.role} in ('owner', 'manager', 'dentist')`),
    check("users_status", sql`${t.status} in ('pending', 'active', 'disabled')`),
    check("users_name", sql`char_length(${t.name}) between 2 and 80`),
    check("users_username", sql`${t.username} ~ '^[a-z0-9._]{3,30}$'`),
    check("users_title", sql`char_length(${t.title}) between 1 and 40`),
    check("users_dentists_see_patients", sql`${t.role} <> 'dentist' or ${t.seesPatients}`),
    check("users_managers_do_not", sql`${t.role} <> 'manager' or not ${t.seesPatients}`),
    uniqueIndex("users_one_owner").on(t.role).where(sql`${t.role} = 'owner'`),
  ],
).enableRLS();

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expiresAt: at("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [index("sessions_user").on(t.userId)],
).enableRLS();

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: at("access_token_expires_at"),
    refreshTokenExpiresAt: at("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [index("accounts_user").on(t.userId)],
).enableRLS();

export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: at("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [index("verifications_identifier").on(t.identifier)],
).enableRLS();

export const rateLimits = pgTable("rate_limits", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
}).enableRLS();

export const userBranches = pgTable(
  "user_branches",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.branchId] })],
).enableRLS();

export const dentistSchedules = pgTable(
  "dentist_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dentistId: uuid("dentist_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    dayOfWeek: smallint("day_of_week").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("dentist_schedules_day", sql`${t.dayOfWeek} between 0 and 6`),
    check("dentist_schedules_order", sql`${t.startTime} < ${t.endTime}`),
    check(
      "dentist_schedules_grid",
      sql`extract(minute from ${t.startTime})::int % 15 = 0 and extract(minute from ${t.endTime})::int % 15 = 0
        and extract(second from ${t.startTime}) = 0 and extract(second from ${t.endTime}) = 0`,
    ),
    index("dentist_schedules_dentist").on(t.dentistId, t.dayOfWeek),
  ],
).enableRLS();

export const dentistTimeOff = pgTable(
  "dentist_time_off",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dentistId: uuid("dentist_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startsAt: at("starts_at").notNull(),
    endsAt: at("ends_at").notNull(),
    reason: text("reason").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("dentist_time_off_order", sql`${t.startsAt} < ${t.endsAt}`),
    check("dentist_time_off_reason", sql`char_length(${t.reason}) <= 100`),
    index("dentist_time_off_dentist").on(t.dentistId, t.startsAt),
  ],
).enableRLS();

export const procedures = pgTable(
  "procedures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    online: boolean("online").notNull().default(true),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    price: integer("price").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check("procedures_name", sql`char_length(${t.name}) between 1 and 60`),
    check("procedures_price", sql`${t.price} between 0 and 100000000`),
  ],
).enableRLS();

/** The dentists who may be assigned a service online (online booking spec, section 5). None means every dentist. */
export const procedureDentists = pgTable(
  "procedure_dentists",
  {
    procedureId: uuid("procedure_id")
      .notNull()
      .references(() => procedures.id, { onDelete: "cascade" }),
    dentistId: uuid("dentist_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.procedureId, t.dentistId] })],
).enableRLS();

/** The allergies the PDA form lists; anything else goes in allergies_other. */
export const ALLERGIES = ["local_anesthetic", "penicillin", "sulfa", "aspirin", "latex"] as const;

export const patients = pgTable(
  "patients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chartNo: integer("chart_no").generatedAlwaysAsIdentity().notNull().unique(),
    lastName: text("last_name").notNull(),
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    birthday: date("birthday"),
    sex: text("sex"),
    mobile: text("mobile"),
    email: text("email"),
    address: text("address"),
    occupation: text("occupation"),
    guardianName: text("guardian_name"),
    emergencyName: text("emergency_name"),
    emergencyMobile: text("emergency_mobile"),
    hmoProvider: text("hmo_provider"),
    hmoMemberNo: text("hmo_member_no"),
    insuranceEffective: date("insurance_effective"),
    allergies: text("allergies").array().notNull().default(sql`'{}'::text[]`),
    allergiesOther: text("allergies_other"),
    medicalAlerts: text("medical_alerts").notNull().default(""),
    consentAt: at("consent_at"),
    consentBy: uuid("consent_by").references(() => users.id),
    homeBranchId: uuid("home_branch_id").references(() => branches.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    check("patients_last_name", sql`char_length(${t.lastName}) between 1 and 50`),
    check("patients_first_name", sql`char_length(${t.firstName}) between 1 and 50`),
    check("patients_middle_name", sql`char_length(${t.middleName}) between 1 and 50`),
    check("patients_birthday", sql`${t.birthday} >= '1900-01-01'`),
    check("patients_sex", sql`${t.sex} in ('female', 'male')`),
    check("patients_mobile", sql`${t.mobile} ~ '^\\+639[0-9]{9}$'`),
    check("patients_emergency_mobile", sql`${t.emergencyMobile} ~ '^\\+639[0-9]{9}$'`),
    check("patients_email", sql`char_length(${t.email}) <= 254 and ${t.email} ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'`),
    check("patients_address", sql`char_length(${t.address}) between 1 and 200`),
    check("patients_occupation", sql`char_length(${t.occupation}) between 1 and 60`),
    check("patients_guardian", sql`char_length(${t.guardianName}) between 1 and 100`),
    check("patients_emergency_name", sql`char_length(${t.emergencyName}) between 1 and 100`),
    check("patients_hmo_provider", sql`char_length(${t.hmoProvider}) between 1 and 60`),
    check("patients_hmo_member_no", sql`char_length(${t.hmoMemberNo}) between 1 and 40`),
    check(
      "patients_allergies",
      sql`${t.allergies} <@ array['local_anesthetic', 'penicillin', 'sulfa', 'aspirin', 'latex']::text[]`,
    ),
    check("patients_allergies_other", sql`char_length(${t.allergiesOther}) between 1 and 100`),
    check("patients_medical_alerts", sql`char_length(${t.medicalAlerts}) <= 500`),
    check("patients_consent", sql`(${t.consentAt} is null) = (${t.consentBy} is null)`),
    index("patients_last_name_lower").on(sql`lower(${t.lastName})`),
    index("patients_mobile").on(t.mobile),
  ],
).enableRLS();

/** A patient's own form, sent from the branch's patient poster (patient forms spec, section 6). It waits for the front desk. */
export const patientForms = pgTable(
  "patient_forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    lastName: text("last_name").notNull(),
    firstName: text("first_name").notNull(),
    middleName: text("middle_name"),
    birthday: date("birthday").notNull(),
    sex: text("sex").notNull(),
    mobile: text("mobile").notNull(),
    address: text("address").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("patient_forms_last_name", sql`char_length(${t.lastName}) between 1 and 50`),
    check("patient_forms_first_name", sql`char_length(${t.firstName}) between 1 and 50`),
    check("patient_forms_middle_name", sql`char_length(${t.middleName}) between 1 and 50`),
    check("patient_forms_birthday", sql`${t.birthday} >= '1900-01-01'`),
    check("patient_forms_sex", sql`${t.sex} in ('female', 'male')`),
    check("patient_forms_mobile", sql`${t.mobile} ~ '^\\+639[0-9]{9}$'`),
    check("patient_forms_address", sql`char_length(${t.address}) between 1 and 200`),
    index("patient_forms_branch_created").on(t.branchId, t.createdAt),
  ],
).enableRLS();

export const APPOINTMENT_STATUSES = [
  "requested",
  "confirmed",
  "checked_in",
  "in_treatment",
  "completed",
  "no_show",
  "cancelled",
] as const;

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    dentistId: uuid("dentist_id")
      .notNull()
      .references(() => users.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    chairNumber: smallint("chair_number").notNull(),
    startTime: at("start_time").notNull(),
    endTime: at("end_time").notNull(),
    chairFreeAt: at("chair_free_at").notNull(),
    status: text("status").notNull(),
    source: text("source").notNull(),
    note: text("note").notNull().default(""),
    cancelReason: text("cancel_reason"),
    confirmedAt: at("confirmed_at"),
    checkedInAt: at("checked_in_at"),
    treatmentStartedAt: at("treatment_started_at"),
    completedAt: at("completed_at"),
    cancelledAt: at("cancelled_at"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.branchId, t.chairNumber], foreignColumns: [chairs.branchId, chairs.number] }),
    check(
      "appointments_status",
      sql`${t.status} in ('requested', 'confirmed', 'checked_in', 'in_treatment', 'completed', 'no_show', 'cancelled')`,
    ),
    check("appointments_source", sql`${t.source} in ('staff', 'walk_in', 'portal')`),
    check("appointments_times", sql`${t.startTime} < ${t.endTime} and ${t.endTime} <= ${t.chairFreeAt}`),
    check("appointments_note", sql`char_length(${t.note}) <= 500`),
    check("appointments_cancel_reason", sql`char_length(${t.cancelReason}) between 1 and 200`),
    check("appointments_cancelled_has_reason", sql`${t.status} <> 'cancelled' or ${t.cancelReason} is not null`),
    index("appointments_branch_time").on(t.branchId, t.startTime),
    index("appointments_dentist_time").on(t.dentistId, t.startTime),
    index("appointments_patient_time").on(t.patientId, t.startTime),
  ],
).enableRLS();

export const appointmentProcedures = pgTable(
  "appointment_procedures",
  {
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    procedureId: uuid("procedure_id")
      .notNull()
      .references(() => procedures.id),
    name: text("name").notNull(),
  },
  (t) => [primaryKey({ columns: [t.appointmentId, t.position] })],
).enableRLS();

export const treatmentNotes = pgTable(
  "treatment_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    amendsId: uuid("amends_id").references((): AnyPgColumn => treatmentNotes.id),
    createdAt: createdAt(),
  },
  (t) => [
    check("treatment_notes_body", sql`char_length(${t.body}) between 1 and 4000`),
    index("treatment_notes_patient").on(t.patientId, t.createdAt),
  ],
).enableRLS();

/** The PDA chart legend; "present" is the check mark. */
export const CHART_CODES = [
  "present",
  "D",
  "M",
  "MO",
  "Im",
  "Sp",
  "Rf",
  "Un",
  "Am",
  "Co",
  "JC",
  "Ab",
  "Att",
  "P",
  "In",
  "Imp",
  "S",
  "Rm",
  "X",
  "XO",
] as const;

export const chartEntries = pgTable(
  "chart_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    branchId: uuid("branch_id").references(() => branches.id),
    tooth: smallint("tooth").notNull(),
    surfaces: text("surfaces").array().notNull().default(sql`'{}'::text[]`),
    code: text("code").notNull(),
    note: text("note").notNull().default(""),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    voidedAt: at("voided_at"),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidReason: text("void_reason"),
  },
  (t) => [
    check(
      "chart_entries_tooth",
      sql`${t.tooth} between 11 and 18 or ${t.tooth} between 21 and 28 or ${t.tooth} between 31 and 38
        or ${t.tooth} between 41 and 48 or ${t.tooth} between 51 and 55 or ${t.tooth} between 61 and 65
        or ${t.tooth} between 71 and 75 or ${t.tooth} between 81 and 85`,
    ),
    check("chart_entries_surfaces", sql`${t.surfaces} <@ array['M', 'D', 'O', 'B', 'L']::text[]`),
    check(
      "chart_entries_code",
      sql`${t.code} in ('present', 'D', 'M', 'MO', 'Im', 'Sp', 'Rf', 'Un', 'Am', 'Co', 'JC', 'Ab', 'Att', 'P', 'In', 'Imp', 'S', 'Rm', 'X', 'XO')`,
    ),
    check("chart_entries_note", sql`char_length(${t.note}) <= 300`),
    check("chart_entries_void_reason", sql`char_length(${t.voidReason}) between 1 and 200`),
    check(
      "chart_entries_void_complete",
      sql`(${t.voidedAt} is null) = (${t.voidedBy} is null) and (${t.voidedAt} is null) = (${t.voidReason} is null)`,
    ),
    index("chart_entries_patient").on(t.patientId, t.tooth),
  ],
).enableRLS();

export const exams = pgTable(
  "exams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .unique()
      .references(() => appointments.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    findings: jsonb("findings").$type<ExamFindings>().notNull(),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("exams_findings", sql`jsonb_typeof(${t.findings}) = 'object' and octet_length(${t.findings}::text) <= 4000`),
    index("exams_patient").on(t.patientId),
  ],
).enableRLS();

/** Who did what and when. user_id has no foreign key: a declined request deletes its user, and the log keeps the id. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: at("at").notNull().defaultNow(),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    branchId: uuid("branch_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index("audit_log_entity").on(t.entity, t.entityId, t.at),
    index("audit_log_user").on(t.userId, t.at),
    index("audit_log_at").on(t.at),
  ],
).enableRLS();

/** A sale, created already paid (billing spec, section 2). Only ever voided, once (DS002 trigger, migration 0007). */
export const bills = pgTable(
  "bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receiptNo: text("receipt_no").notNull().unique(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    patientId: uuid("patient_id").references(() => patients.id),
    appointmentId: uuid("appointment_id").references(() => appointments.id),
    day: date("day").notNull(),
    method: text("method").notNull(),
    total: integer("total").notNull(),
    tendered: integer("tendered"),
    changeDue: integer("change_due"),
    reference: text("reference"),
    status: text("status").notNull().default("paid"),
    issuedBy: uuid("issued_by")
      .notNull()
      .references(() => users.id),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    voidReason: text("void_reason"),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidedAt: at("voided_at"),
  },
  (t) => [
    check("bills_method", sql`${t.method} in ('cash', 'qr')`),
    check("bills_status", sql`${t.status} in ('paid', 'void')`),
    check("bills_total", sql`${t.total} between 1 and 1000000000`),
    check(
      "bills_cash_fields",
      sql`(${t.method} = 'cash' and ${t.tendered} is not null and ${t.changeDue} is not null and ${t.tendered} >= ${t.total} and ${t.changeDue} = ${t.tendered} - ${t.total})
        or (${t.method} = 'qr' and ${t.tendered} is null and ${t.changeDue} is null)`,
    ),
    check("bills_reference", sql`char_length(${t.reference}) between 1 and 60`),
    check(
      "bills_void_fields",
      sql`(${t.status} = 'paid' and ${t.voidReason} is null and ${t.voidedBy} is null and ${t.voidedAt} is null)
        or (${t.status} = 'void' and char_length(${t.voidReason}) between 1 and 200 and ${t.voidedBy} is not null and ${t.voidedAt} is not null)`,
    ),
    index("bills_branch_day").on(t.branchId, t.day),
    uniqueIndex("bills_one_paid_per_visit").on(t.appointmentId).where(sql`${t.status} = 'paid' and ${t.appointmentId} is not null`),
  ],
).enableRLS();

/** A bill's lines as sold: a snapshot, so a later price change never rewrites a receipt. */
export const billLines = pgTable(
  "bill_lines",
  {
    billId: uuid("bill_id")
      .notNull()
      .references(() => bills.id),
    position: smallint("position").notNull(),
    name: text("name").notNull(),
    qty: integer("qty").notNull(),
    unitPrice: integer("unit_price").notNull(),
    procedureId: uuid("procedure_id").references(() => procedures.id),
  },
  (t) => [
    primaryKey({ columns: [t.billId, t.position] }),
    check("bill_lines_name", sql`char_length(${t.name}) between 1 and 100`),
    check("bill_lines_qty", sql`${t.qty} between 1 and 999`),
    check("bill_lines_unit_price", sql`${t.unitPrice} between 0 and 100000000`),
  ],
).enableRLS();

/** The last receipt sequence used per branch and day. Its row lock also orders issuing, voiding and closing a day. */
export const billCounters = pgTable(
  "bill_counters",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    day: date("day").notNull(),
    lastSeq: integer("last_seq").notNull(),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.day] })],
).enableRLS();

/** A closed day: what the sales said, and what was counted. Never changed; a closed day stays closed. */
export const cashCloses = pgTable(
  "cash_closes",
  {
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    day: date("day").notNull(),
    expectedCash: integer("expected_cash").notNull(),
    expectedQr: integer("expected_qr").notNull(),
    countedCash: integer("counted_cash").notNull(),
    closedBy: uuid("closed_by")
      .notNull()
      .references(() => users.id),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.branchId, t.day] }),
    check("cash_closes_amounts", sql`${t.expectedCash} >= 0 and ${t.expectedQr} >= 0 and ${t.countedCash} between 0 and 1000000000`),
  ],
).enableRLS();
