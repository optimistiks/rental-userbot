export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = (error as { name?: unknown }).name
    if (typeof name === 'string' && name !== '') {
      return name
    }
  }

  return error instanceof Error ? error.name : 'Error'
}
