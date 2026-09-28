/** Play Store spec 3.3: two or more dot-separated segments, each a letter then letters, digits, or underscores. */
const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

/** A Play Console SHA-256 certificate fingerprint: 32 colon-separated pairs of uppercase hex digits (spec 3.3). */
const CERT_FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function isAndroidPackageName(value: string): boolean {
  return PACKAGE_NAME.test(value);
}

export function isAndroidCertFingerprint(value: string): boolean {
  return CERT_FINGERPRINT.test(value);
}

/** ANDROID_CERT_SHA256 (spec 3.1): comma separated, so the upload key and Play App Signing key can both be listed. */
export function parseAndroidCertFingerprints(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
