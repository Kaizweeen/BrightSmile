export const CLINIC = {
  name: "Bright Smile Dental Clinic",
  phone: "0956-342-1673",
  phoneHref: "tel:09563421673",
  hours: "9:00 AM to 5:00 PM",
  facebook: "https://www.facebook.com/BrightSmileDentalClinicMakatiPRC",
  bookingUrl: "https://www.brightsmile.pro/welcome/clinic1",
};

export const DOCTORS = [
  "Ma. Teresita Balingasay-Montealegre, DMD",
  "Patricia Marie Montealegre-Mendoza, DMD",
];

export const PRACTICE = [
  "General Dentistry",
  "Orthodontics",
  "Cosmetics",
  "Surgery",
  "Pediatric Dentistry",
  "Endodontics",
];

export const SERVICES: [string, string][] = [
  ["Dental Consultation", "Check-up and advice"],
  ["Oral Prophylaxis", "Cleaning"],
  ["Tooth Extraction", "Bunot"],
  ["Tooth Filling", "Pasta"],
  ["Dentures", "Pustiso"],
  ["Braces and Retainers", "Straighten your teeth"],
  ["Laser Teeth Whitening", "Bleach"],
  ["Veneers and Crowns", "Fix and improve teeth"],
  ["Fixed Partial Dentures", "Bridge"],
  ["Mouthguard / Nightguard", "Protect your teeth"],
  ["Root Canal Therapy", "Save a painful tooth"],
  ["Odontectomy", "Impacted wisdom tooth extraction"],
  ["Fluoride Application and Sealants", "Stronger teeth for kids and adults"],
];

// Addresses are shown as written on the card. Map links use the exact coordinates.
export const CLINICS = [
  { name: "Clinic 1", addr: "8219 Constancia St., Brgy. Olympia, Makati City", lat: 14.574028, lng: 121.022806 },
  { name: "Clinic 2", addr: "1065 Chino Roces Ave., Makati City", lat: 14.571619, lng: 121.015545 },
  { name: "Clinic 3", addr: "Lot 16 Blk 82 Milkweed St., Brgy. Rizal, Makati City", lat: 14.537053, lng: 121.0596 },
];

// QR code (33 x 33 modules, # = dark). It points to CLINIC.bookingUrl.
export const QR_ROWS = [
  "#######.#.#.#...#.######..#######",
  "#.....#.#.....#.##.....#..#.....#",
  "#.###.#...##.###..##...#..#.###.#",
  "#.###.#.##.##..#..##.#..#.#.###.#",
  "#.###.#..#.##...#.#...###.#.###.#",
  "#.....#..##.#####.#..###..#.....#",
  "#######.#.#.#.#.#.#.#.#.#.#######",
  "........##.....###.#....#........",
  "#.##.###....#.##.##..#.#..#..#.##",
  "...#.#.#..####..#####..#..##.##.#",
  "...##.##..####..#.#..###...###.##",
  "##.....#.#.....#.#.######..#.#..#",
  ".....##...#...#.#..#######.###.##",
  "..##.#..##....#..#..##.#...#..##.",
  "#...#.####..###...###.#.#.#.##...",
  ".#.###.##.##.#.#.....##.###.###..",
  "#..#..#.#....##.....####.##.###..",
  "######.##..##..##...#.##..#.##.##",
  "#..####.#.#.#####.#.##...####.##.",
  "######.##.##.#.######.#.#...#..#.",
  ".##...###.#..#.##..#..#.#....###.",
  "#.##.....#....####..#####.#..##.#",
  "..##..##....#..#..###########..##",
  ".####..##.#.####....#..#..#.#...#",
  "#.....##.#..#....#.##.#.#####...#",
  "........##...####.##.#..#...##...",
  "#######.######..####.#.##.#.#....",
  "#.....#.#.###....##.#..##...###..",
  "#.###.#..#.###..###...#######.##.",
  "#.###.#.#.##.##.#..#.####..#.####",
  "#.###.#.#..######.#.##.#####.#...",
  "#.....#..##.#....#..#..##..##...#",
  "#######.#.....#..#####.#....#.#..",
];

export const NAV = [
  { href: "#doctors", label: "Doctors" },
  { href: "#services", label: "Services" },
  { href: "#locations", label: "Locations" },
];
