import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";

// Same pairing and weights as Planorama, so the two projects set type identically.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

// The design contract for this interface, emitted into the page so any build
// can be audited against the intent it was made from. Product terms only:
// process notes and internal references live in docs, not in page output.
const DIRECTION_CONTRACT = `
BrightSmile design contract (ref 47009352)
IDEA: One product family, one interface language, so a patient meets the same calm surface the clinic works in.
SYSTEM: Cream canvas (#F7F3EA), white cards at a 14px radius with a soft two-layer shadow, teal primary (#12727E) carrying the one action per screen, navy ink (#0F3A52), gold (#C9A24B) as accent, all taken from the BrightSmile logo. Poppins headings over Inter text at 14px. Soft status chips: green confirmed, amber waiting, red closed or refused. Circular calendar days. Fields at an 11px radius with a 3px focus ring.
STORY: A patient picks what they need, picks a day and time from real availability, leaves a mobile number, and gets a confirmation they can screenshot.
FIRST VIEW: One white card centred on cream. Clinic mark and name, opening hours read from the clinic's own data, a three step row, then procedures as pickable rows with durations on the right and a single teal action at the foot.
RULES: Status never rests on colour alone, every state carries a word. Struck through means closed or full, nothing else. Targets at least 44px. Type sized for a phone at arm's length in a bright room. Reduced motion respected.
`;

export const metadata: Metadata = {
  title: { default: "BrightSmile", template: "%s | BrightSmile" },
  description: "Online booking for dental clinics in the Philippines.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${poppins.variable}`}>
      <body>
        <div dangerouslySetInnerHTML={{ __html: `<!--${DIRECTION_CONTRACT}-->` }} />
        {children}
      </body>
    </html>
  );
}
