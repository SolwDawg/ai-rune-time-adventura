export function normalizeText(value: string): string {
  return value.normalize('NFC')
}
