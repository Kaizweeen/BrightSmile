export type SmsKind =
  | "otp"
  | "request_alert"
  | "confirmed"
  | "declined"
  | "moved"
  | "cancelled"
  | "reminder"
  | "patient_cancel_alert"
  | "low_credit";

export type SmsVars = {
  clinic?: string;
  first?: string;
  lastInitial?: string;
  dentist?: string;
  date?: string;
  time?: string;
  reason?: string;
  link?: string;
  bookLink?: string;
  appUrl?: string;
  code?: string;
  credits?: number;
};

/**
 * Printable ASCII minus the GSM-7 extension characters, so every character costs one unit
 * and no gateway switches the text to Unicode (which cuts a part to 70 characters).
 */
export function toSmsText(text: string): string {
  return text
    .replace(/\u20B1/g, "PHP")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[[\\\]^`{|}~]/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** Spec section 10.1. Every template fits in 160 characters with the field limits in Global Constraints. */
export function renderSms(kind: SmsKind, v: SmsVars): string {
  // Reduce and cap the free text fields first, so the 160 budget below is computed on what actually
  // goes out (toSmsText can grow text, PHP for the peso sign and NFKD ellipsis expansion for example).
  const clinic = toSmsText(v.clinic ?? "").slice(0, 20);
  const first = toSmsText(v.first ?? "").slice(0, 12);
  const dentist = v.dentist ? toSmsText(v.dentist).slice(0, 16) : "";
  const rawReason = v.reason ? toSmsText(v.reason).slice(0, 36) : "";
  const who = `${first} ${v.lastInitial ?? ""}.`;
  const withDentist = dentist ? ` with ${dentist}` : "";
  const reason = rawReason ? ` ${/[.!?]$/.test(rawReason) ? rawReason : `${rawReason}.`}` : "";
  const texts: Record<SmsKind, () => string> = {
    otp: () => `Your code for ${clinic} is ${v.code}. It expires in 5 minutes. Don't share it with anyone.`,
    request_alert: () => `New request: ${who}, ${v.date} ${v.time}${withDentist}. Approve at ${v.appUrl}/app/requests`,
    confirmed: () => `${clinic}: ${first}'s visit on ${v.date}, ${v.time}${withDentist} is confirmed. View or cancel: ${v.link}`,
    declined: () => `${clinic} can't take ${v.date}, ${v.time}.${reason} Rebook: ${v.bookLink}`,
    moved: () => `${clinic}: ${first}'s visit moved to ${v.date}, ${v.time}${withDentist}. View or cancel: ${v.link}`,
    cancelled: () => `${clinic} cancelled the ${v.date}, ${v.time} visit.${reason} Rebook: ${v.bookLink}`,
    reminder: () => `${clinic}: Reminder, ${first}'s visit is tomorrow at ${v.time}${withDentist}. Can't come? Cancel: ${v.link}`,
    patient_cancel_alert: () => `Cancelled: ${who}, ${v.date}, ${v.time}${withDentist}.`,
    low_credit: () => `BrightSmile: Semaphore balance is ${v.credits} credits. Top up before reminders fail.`,
  };
  const body = texts[kind]();
  // Semaphore's OTP route fills in the {otp} placeholder (or the caller passes a real code) verbatim,
  // so skip the brace-stripping pass for this kind. Every other piece of the body is already reduced.
  return kind === "otp" ? body : toSmsText(body);
}

/** Semaphore credits: one per 160 characters (153 per part when split), doubled on the OTP route. */
export function smsCredits(kind: SmsKind, body: string): number {
  const parts = body.length <= 160 ? 1 : Math.ceil(body.length / 153);
  return parts * (kind === "otp" ? 2 : 1);
}
