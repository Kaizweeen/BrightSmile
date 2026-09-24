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

const DIRECTION_CONTRACT = `
THESIS: BrightSmile wears Kai's Planorama house style, pinned by him over the rolled direction. One product family, one interface language: a patient meets the same calm surface the clinic works in.
OWN-WORLD: Lavender canvas (#F7F6FB), white cards with a 14px radius and a soft two-layer shadow, purple primary (#6D28D9) with a purple glow under the main action, Poppins headings over Inter text at 14px, soft status chips (green confirmed, amber waiting, red closed), circular calendar days, 11px rounded fields with a 3px purple focus ring. Carried from Planorama's globals.css, not approximated.
STORY: A patient picks what they need, picks a day and time from real availability, leaves their number, and gets a confirmation card they can screenshot.
FIRST VIEWPORT: One white flow card centred on lavender. Purple brand mark, clinic name in Poppins, hours read off the clinic's own data, a three-step pip row, then the procedure list as pickable rows with durations on the right and one purple action at the bottom.
FORM: user-pinned house style (Planorama), which replaces seed 47009352's Kalendaryo direction; code-led.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
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
