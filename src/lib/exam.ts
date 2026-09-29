import { z } from "zod";

/** The exam sections under the PDA chart (spec 9.2). A marked item may carry a detail, such as "16, 26" for periapicals. */
export const EXAM_SECTIONS = [
  {
    key: "periodontal",
    label: "Periodontal screening",
    items: [
      { key: "gingivitis", label: "Gingivitis" },
      { key: "early_periodontitis", label: "Early periodontitis" },
      { key: "moderate_periodontitis", label: "Moderate periodontitis" },
      { key: "advanced_periodontitis", label: "Advanced periodontitis" },
    ],
  },
  {
    key: "occlusion",
    label: "Occlusion",
    items: [
      { key: "molar_class", label: "Class (molar)" },
      { key: "overjet", label: "Overjet" },
      { key: "overbite", label: "Overbite" },
      { key: "midline_deviation", label: "Midline deviation" },
      { key: "crossbite", label: "Crossbite" },
    ],
  },
  {
    key: "appliances",
    label: "Appliances",
    items: [
      { key: "orthodontic", label: "Orthodontic" },
      { key: "stayplate", label: "Stayplate" },
      { key: "others", label: "Others" },
    ],
  },
  {
    key: "tmd",
    label: "TMD",
    items: [
      { key: "clenching", label: "Clenching" },
      { key: "clicking", label: "Clicking" },
      { key: "trismus", label: "Trismus" },
      { key: "muscle_spasm", label: "Muscle spasm" },
    ],
  },
  {
    key: "xrays",
    label: "X-rays taken",
    items: [
      { key: "periapical", label: "Periapical (tooth numbers)" },
      { key: "panoramic", label: "Panoramic" },
      { key: "cephalometric", label: "Cephalometric" },
      { key: "occlusal", label: "Occlusal (upper or lower)" },
      { key: "others", label: "Others" },
    ],
  },
] as const;

const detail = z.string().trim().max(60, "Use at most 60 characters");

/** Marked items only, per section: `{ xrays: { periapical: "16, 26" } }`. Unknown sections and items are refused. */
export const examFindingsSchema = z.strictObject(
  Object.fromEntries(
    EXAM_SECTIONS.map((s) => [s.key, z.partialRecord(z.enum(s.items.map((i) => i.key) as [string, ...string[]]), detail).optional()]),
  ),
);
