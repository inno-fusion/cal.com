/**
 * Truncates a Razorpay order notes value to the API's maximum allowed length.
 * Razorpay rejects orders where any notes value exceeds 256 characters.
 * Uses an ellipsis character (…) rather than three dots to save one character.
 */
export function truncateNote(value: string, maxChars = 256): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars - 1) + "\u2026";
}
