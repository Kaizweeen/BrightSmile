import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const ORIGIN = "https://bsmile.vercel.app";

type Listener = (event: unknown) => void;

/** Runs public/sw.js in a stand-in worker, delivers one push, taps its notification, and returns the pages opened. */
async function tapPush(payload: unknown): Promise<string[]> {
  const listeners: Record<string, Listener> = {};
  const shown: { data?: unknown }[] = [];
  const opened: string[] = [];
  let pending: Promise<unknown> = Promise.resolve();
  const waitUntil = (work: Promise<unknown>) => {
    pending = work;
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, listener: Listener) => {
      listeners[type] = listener;
    },
    skipWaiting: () => {},
    registration: {
      showNotification: async (_title: string, options: { data?: unknown }) => {
        shown.push(options);
      },
    },
    clients: {
      claim: async () => {},
      matchAll: async () => [],
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
  };
  runInNewContext(readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"), { self, URL });
  listeners.push({ data: { json: () => payload }, waitUntil });
  await pending;
  listeners.notificationclick({ notification: { close: () => {}, data: shown[0].data }, waitUntil });
  await pending;
  return opened;
}

describe("the service worker", () => {
  it("opens Reports for the Monday summary (teams spec 6.4)", async () => {
    expect(await tapPush({ title: "Last week at Bright Dental", body: "12 visits, 3 no-shows (20%).", url: "/app/reports", type: "weekly" })).toEqual([
      `${ORIGIN}/app/reports`,
    ]);
  });

  it("opens the requests page for everything else, and never a URL from the payload", async () => {
    expect(await tapPush({ title: "New booking request", body: "Thu Sep 24, 10:00 AM", url: "https://evil.example/" })).toEqual([`${ORIGIN}/app/requests`]);
    expect(await tapPush({ title: "Hi", body: "There", url: "https://evil.example/", type: "https://evil.example/" })).toEqual([`${ORIGIN}/app/requests`]);
  });
});
