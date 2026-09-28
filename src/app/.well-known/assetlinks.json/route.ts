import { isAndroidCertFingerprint, isAndroidPackageName, parseAndroidCertFingerprints } from "@/lib/android";

/**
 * Play Store spec 3.1: proves BrightSmile owns the Android app, so Chrome opens the Trusted Web Activity with
 * no browser bar. Public by design (Google fetches this over plain HTTP with no auth), so it is left out of
 * src/proxy.ts's matcher and of the noindex and robots rules in src/lib/security-headers.ts.
 */
export function GET() {
  const packageName = process.env.ANDROID_PACKAGE_NAME?.trim();
  const fingerprints = parseAndroidCertFingerprints(process.env.ANDROID_CERT_SHA256 ?? "");
  const ready = packageName && isAndroidPackageName(packageName) && fingerprints.length > 0 && fingerprints.every(isAndroidCertFingerprint);
  if (!ready) return new Response(null, { status: 404 });

  return Response.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: fingerprints },
      },
    ],
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
