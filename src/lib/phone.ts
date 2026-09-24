/** "+639171234567" from any common way of writing a Philippine mobile number, or null. */
export function normalizeMobile(input: string): string | null {
  const match = input.replace(/[\s().-]/g, "").match(/^(?:\+63|63|0)?(9\d{9})$/);
  return match ? `+63${match[1]}` : null;
}

/** "09171234567": how people write it, and the format Semaphore expects. */
export function localMobile(e164: string): string {
  return `0${e164.slice(3)}`;
}
