// Renders promo.html to an MP4, one screenshot per frame piped into ffmpeg.
//   node marketing/promo-video/render.mjs              -> promo-picture.mp4 (picture only; audio.py adds the sound)
//   node marketing/promo-video/render.mjs --stills 1.5 9 20  -> PNGs of those moments, for checking a layout fast
// Needs ffmpeg on the PATH and a Playwright Chromium (`npx playwright install chromium`), or PLAYWRIGHT_CHANNEL=chrome, or CHROMIUM_PATH=/path/to/chrome.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const args = process.argv.slice(2);

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL, executablePath: process.env.CHROMIUM_PATH });
// 540 x 960 CSS pixels at 2x gives a 1080 x 1920 frame.
const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(join(here, "promo.html")).href);
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => img.decode()));
});
const duration = await page.evaluate(() => window.DURATION);

async function frameAt(t) {
  await page.evaluate((s) => window.seek(s), t);
  return page.screenshot({ type: "png" });
}

if (args[0] === "--stills") {
  for (const t of args.slice(1).map(Number)) {
    const file = join(here, `still-${t}.png`);
    await page.evaluate((s) => window.seek(s), t);
    await page.screenshot({ path: file });
    console.log(file);
  }
} else {
  const out = join(here, "promo-picture.mp4");
  const ffmpeg = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
    // A silent stereo track keeps this file uploadable on its own; audio.py replaces it with the voiceover and effects.
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-shortest", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((resolve, reject) => ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)))));

  const frames = Math.round(duration * FPS);
  for (let i = 0; i < frames; i++) {
    const png = await frameAt(i / FPS);
    if (!ffmpeg.stdin.write(png)) await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
    if (i % FPS === 0) process.stdout.write(`\r${i / FPS}s / ${duration}s`);
  }
  ffmpeg.stdin.end();
  await done;
  console.log(`\n${out}`);
}

await browser.close();
