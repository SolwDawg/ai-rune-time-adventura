export function sanitizeAiText(value: string, maxLength = 480): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return normalized.slice(0, maxLength).trim()
}
