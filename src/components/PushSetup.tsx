"use client";

import { useEffect, useState } from "react";
import { disablePush, enablePush } from "@/app/app/settings/actions";

type State = "checking" | "unsupported" | "blocked" | "off" | "on";

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const FAILED = "This device could not turn on push. Try again, or keep text alerts.";

/** The VAPID public key as bytes, as pushManager.subscribe wants it (from the Next.js PWA guide). */
function keyBytes(base64url: string) {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Where this device stands. A subscription the browser already has is saved again, so a row deleted
 * after a 410 (or never saved) heals itself when Settings opens.
 */
async function currentState(): Promise<State> {
  if (!KEY || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  const sub = await registration.pushManager.getSubscription();
  if (!sub) return "off";
  return (await enablePush(sub.toJSON())).ok ? "on" : "off";
}

/** Spec 10.4: "Enable push on this device", per device, with the iPhone home screen note. */
export default function PushSetup() {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let live = true;
    currentState().then(
      (s) => {
        if (live) setState(s);
      },
      () => {
        if (live) setState("unsupported");
      },
    );
    return () => {
      live = false;
    };
  }, []);

  async function turnOn() {
    setWorking(true);
    setError("");
    try {
      // First, straight from the tap: iPhone only shows the prompt for a user gesture.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const sub =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(KEY) }));
      const result = await enablePush(sub.toJSON());
      if (result.ok) setState("on");
      else setError(result.error);
    } catch {
      setError(FAILED);
    } finally {
      setWorking(false);
    }
  }

  async function turnOff() {
    setWorking(true);
    setError("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        const result = await disablePush(sub.endpoint);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section id="alerts" className="card card-pad settings-section">
      <h2 className="font-display">Alerts on this device</h2>
      {state === "checking" && <p className="f-hint">Checking this device...</p>}
      {state === "on" && (
        <>
          <p className="f-hint" role="status">
            <span className="chip chip-green">Push on</span> This device gets a push for each new request and cancellation.
          </p>
          <button type="button" className="btn btn-ghost mt-3" disabled={working} onClick={() => void turnOff()}>
            {working ? "Turning off..." : "Turn off push on this device"}
          </button>
        </>
      )}
      {state === "off" && (
        <>
          <p className="f-hint">Get a push on this phone or computer for each new request, even when BrightSmile is closed.</p>
          <button type="button" className="btn btn-soft mt-3" disabled={working} onClick={() => void turnOn()}>
            {working ? "Turning on..." : "Enable push on this device"}
          </button>
        </>
      )}
      {state === "blocked" && (
        <p className="note-box warn mt-3">
          Notifications are blocked for BrightSmile on this device. Allow them in your browser&apos;s site settings, then open this page again.
        </p>
      )}
      {state === "unsupported" && (
        <p className="note-box mt-3">Push isn&apos;t available in this browser, so alerts arrive by text.</p>
      )}
      {error && (
        <p className="field-err" role="alert">
          {error}
        </p>
      )}
      <p className="f-hint mt-3">
        On iPhone or iPad (iOS 16.4 or later), push works only from the home screen app: open this page in Safari, tap Share, then Add to
        Home Screen, open BrightSmile from the new icon, and turn push on there.
      </p>
    </section>
  );
}
