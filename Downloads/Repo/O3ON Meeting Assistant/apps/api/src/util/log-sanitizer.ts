const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export function sanitizeForLog(message: string): string {
  return message.replace(EMAIL_REGEX, "[REDACTED]");
}
