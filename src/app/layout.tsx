import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

// One family, two roles: text at normal width, printed display lettering
// expanded and heavy. Archivo's tabular figures carry every time and date.
const body = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-body" });

const DIRECTION_CONTRACT = `
THESIS: The clinic's own wall calendar, not a calendar widget bolted into a dashboard. Refuses the white-card booking UI every competitor ships.
OWN-WORLD: A paper sheet on a wall. Square corners, printed hairlines, and inks that mean things: ballpen blue is written down but unstamped, green is the stamp, calendar red is closed or refused, gold belongs to the clinic's own name. Archivo throughout, expanded and black for dates.
STORY: A patient opens the clinic's sheet, tears off a day, and gets a time they can hold. Staff open today's sheet and stamp it.
FIRST VIEWPORT: Patient: gold-line masthead, the month below with closed days struck in red, the chosen day tearing off to show printed times. Clinic: today's date huge, appointments ruled down the sheet, pending ones in ballpen blue at the top, one green Approve.
FORM: challenger, printing-house calendar pad; beat grounded candidate 4 of 7 (HMO card and claim form); seed 47009352, re-roll 1, code-led.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
`;

export const metadata: Metadata = {
  title: { default: "BrightSmile", template: "%s | BrightSmile" },
  description: "Online booking for dental clinics in the Philippines.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={body.variable}>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">
        <div dangerouslySetInnerHTML={{ __html: `<!--${DIRECTION_CONTRACT}-->` }} />
        {children}
      </body>
    </html>
  );
}
