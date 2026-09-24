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
    .replace(/₱/g, "PHP")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[[\\\]^`{|}~]/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** Spec section 10.1. Every template fits in 160 characters with the field limits in Global Constraints. */
export function renderSms(kind: SmsKind, v: SmsVars): string {
  const first = (v.first ?? "").slice(0, 12);
  const who = `${first} ${v.lastInitial ?? ""}.`;
  const withDentist = v.dentist ? ` with ${v.dentist}` : "";
  const reason = v.reason ? ` ${/[.!?]$/.test(v.reason) ? v.reason : `${v.reason}.`}` : "";
  const texts: Record<SmsKind, () => string> = {
    otp: () => `Your code for ${v.clinic} is ${v.code}. It expires in 5 minutes. Don't share it with anyone.`,
    request_alert: () => `New request: ${who}, ${v.date} ${v.time}${withDentist}. Approve at ${v.appUrl}/app/requests`,
    confirmed: () => `${v.clinic}: ${first}'s visit on ${v.date}, ${v.time}${withDentist} is confirmed. View or cancel: ${v.link}`,
    declined: () => `${v.clinic} can't take ${v.date}, ${v.time}.${reason} Rebook: ${v.bookLink}`,
    moved: () => `${v.clinic}: ${first}'s visit moved to ${v.date}, ${v.time}${withDentist}. View or cancel: ${v.link}`,
    cancelled: () => `${v.clinic} cancelled the ${v.date}, ${v.time} visit.${reason} Rebook: ${v.bookLink}`,
    reminder: () => `${v.clinic}: Reminder, ${first}'s visit is tomorrow at ${v.time}${withDentist}. Can't come? Cancel: ${v.link}`,
    patient_cancel_alert: () => `Cancelled: ${who}, ${v.date}, ${v.time}${withDentist}.`,
    low_credit: () => `BrightSmile: Semaphore balance is ${v.credits} credits. Top up before reminders fail.`,
  };
  return toSmsText(texts[kind]());
}

/** Semaphore credits: one per 160 characters (153 per part when split), doubled on the OTP route. */
export function smsCredits(kind: SmsKind, body: string): number {
  const parts = body.length <= 160 ? 1 : Math.ceil(body.length / 153);
  return parts * (kind === "otp" ? 2 : 1);
}
