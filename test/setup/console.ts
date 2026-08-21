import { afterEach, beforeEach, vi, type MockInstance } from 'vitest'

/**
 * Console tripwire: a test fails if it logs a warning or error without claiming it via
 * {@link expectConsole} — catches Vue warnings (bad props, duplicate keys, watcher errors) that
 * would otherwise pass silently.
 *
 * Register as a `setupFiles` entry, or import {@link expectConsole} directly — both arm it, since
 * these hooks register on module evaluation.
 */

export type ConsoleLevel = 'error' | 'warn'

type ConsoleSpy = MockInstance<(...args: unknown[]) => void>

const LEVELS: readonly ConsoleLevel[] = ['error', 'warn']

const spies = new Map<ConsoleLevel, ConsoleSpy>()
/** Substrings the test under way has claimed, per level. */
const claims = new Map<ConsoleLevel, string[]>()

/**
 * Claims console output for the current test: every substring must match at least one call and vice
 * versa, or the test fails. Returns the spy so callers can assert on the exact arguments.
 */
export function expectConsole(level: ConsoleLevel, ...substrings: string[]): ConsoleSpy {
  const spy = spies.get(level)
  if (!spy) throw new Error(`[vp-search] expectConsole('${level}') ran outside a test`)
  claims.get(level)?.push(...substrings)
  return spy
}

function install(level: ConsoleLevel): ConsoleSpy {
  const spy = vi.spyOn(console, level).mockImplementation(() => {}) as ConsoleSpy
  spies.set(level, spy)
  claims.set(level, [])
  return spy
}

/** Restores the console and returns what the test failed to claim. */
function reset(level: ConsoleLevel): string[] {
  const spy = spies.get(level)
  if (!spy) return []
  const calls = spy.mock.calls.map(format)
  const claimed = claims.get(level) ?? []
  spies.delete(level)
  claims.delete(level)
  spy.mockRestore()

  const unclaimed = calls
    .filter((call) => !claimed.some((substring) => call.includes(substring)))
    .map((call) => `unexpected console.${level}: ${call}`)
  const unmet = claimed
    .filter((substring) => !calls.some((call) => call.includes(substring)))
    .map((substring) => `claimed console.${level} never logged: ${substring}`)
  return [...unclaimed, ...unmet]
}

function format(args: unknown[]): string {
  return args
    .map((arg) => {
      try {
        return arg instanceof Error ? `${arg.name}: ${arg.message}` : String(arg)
      } catch {
        return '[unstringifiable]'
      }
    })
    .join(' ')
}

beforeEach(() => {
  for (const level of LEVELS) install(level)
})

afterEach(() => {
  const failures = LEVELS.flatMap(reset)
  if (failures.length) throw new Error(`console tripwire\n  - ${failures.join('\n  - ')}`)
})
