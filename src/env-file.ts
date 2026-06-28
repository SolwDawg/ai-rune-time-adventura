export function loadRuntimeEnvFile(path = '.env'): void {
  try {
    process.loadEnvFile(path)
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
