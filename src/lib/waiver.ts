/**
 * The consent waiver of the patient form (booking flow spec 6, item 7). Every signature stores WAIVER_VERSION with the
 * typed name and the time, so change the version whenever the words change. Drafted by us and waiting for legal review:
 * the wording, a cancellation and no-show policy, and minors signing through a guardian.
 */
export const WAIVER_VERSION = "2026-09-26";

/** The waiver's two paragraphs, each a bold title and its text, naming the clinic. */
export function waiverText(clinicName: string): { title: string; text: string }[] {
  return [
    {
      title: "Consent for dental examination and treatment.",
      text:
        "I confirm that the information I gave is true and complete to the best of my knowledge, and I will tell the clinic of any change in my health. " +
        `I allow the dentists of ${clinicName} to examine me and to explain the treatment I need; no treatment will start without my consent to it. ` +
        "I understand that dental treatment carries risks the dentist will explain before treatment, and that results cannot be guaranteed.",
    },
    {
      title: "Data privacy consent.",
      text:
        `I allow ${clinicName}, and BrightSmile as its booking service, to collect, keep, and use my personal and health information ` +
        "to book and manage my appointments and for my dental care, as described in the Privacy Notice. I may ask to see, correct, or delete it.",
    },
  ];
}
