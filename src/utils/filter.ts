export function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => new RegExp(pattern, 'i'))
}

export function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value))
}

