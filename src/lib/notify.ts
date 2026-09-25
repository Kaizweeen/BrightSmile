import "server-only";
import { appUrl } from "@/lib/app-url";
import { logError } from "@/lib/log";
import { planPushPayload, pushPayload, sendPush, type AlertKind } from "@/lib/push";
import { sendSms } from "@/lib/sms/send";
import { adminClient } from "@/lib/supabase/admin";
import { formatDate, formatTime } from "@/lib/time";

export type ClinicAlert = {
  kind: AlertKind;
  clinicId: string;
  appointmentId: string;
  first: string;
  last: string;
  startsAt: Date;
  /** The dentist's short name when the clinic has 2 or more active dentists, otherwise null. */
  dentist: string | null;
};

/**
 * Spec 10.4: push first when the clinic chose push; a text to the clinic mobile when no push was
 * delivered or the clinic chose texts. Never throws, so a failed alert never undoes a booking.
 */
export async function alertClinic(alert: ClinicAlert): Promise<"push" | "sms" | "failed"> {
  try {
    const { data, error } = await adminClient().from("clinics").select("mobile, alert_channel").eq("id", alert.clinicId).single();
    if (error) throw error;
    const clinic = data as { mobile: string; alert_channel: "push" | "sms" };

    if (clinic.alert_channel === "push") {
      const delivered = await sendPush(alert.clinicId, pushPayload(alert.kind, alert.startsAt, alert.dentist));
      if (delivered > 0) return "push";
    }

    const status = await sendSms({
      kind: alert.kind,
      to: clinic.mobile,
      clinicId: alert.clinicId,
      appointmentId: alert.appointmentId,
      vars: {
        first: alert.first,
        lastInitial: alert.last.trim().charAt(0).toUpperCase(),
        date: formatDate(alert.startsAt),
        time: formatTime(alert.startsAt),
        dentist: alert.dentist ?? undefined,
        appUrl: appUrl(),
      },
    });
    return status === "failed" ? "failed" : "sms";
  } catch (e) {
    logError("alertClinic", e);
    return "failed";
  }
}

/**
 * Billing spec 7.4: the plan heads-up, by the same channel rule as alertClinic. A push to the clinic's devices
 * when it chose push; a text to the clinic mobile when no push was delivered or it chose texts. Never throws.
 */
export async function alertPlanEnding(clinicId: string, endsAt: Date): Promise<"push" | "sms" | "failed"> {
  try {
    const { data, error } = await adminClient().from("clinics").select("sms_name, mobile, alert_channel").eq("id", clinicId).single();
    if (error) throw error;
    const clinic = data as { sms_name: string; mobile: string; alert_channel: "push" | "sms" };

    if (clinic.alert_channel === "push" && (await sendPush(clinicId, planPushPayload(endsAt))) > 0) return "push";

    const status = await sendSms({
      kind: "renewal",
      to: clinic.mobile,
      clinicId,
      vars: { clinic: clinic.sms_name, date: formatDate(endsAt), appUrl: appUrl() },
    });
    return status === "failed" ? "failed" : "sms";
  } catch (e) {
    logError("alertPlanEnding", e);
    return "failed";
  }
}
