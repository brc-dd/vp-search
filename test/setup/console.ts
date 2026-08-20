import { afterEach, beforeEach, vi, type MockInstance } from 'vitest'

/**
 * Console tripwire (the vuejs/core pattern): a test that logs a warning or an
 * error fails unless it claims the output with {@link expectConsole}. Vue's own
 * warnings — bad props, duplicate `v-for` keys, unhandled errors in watchers —
 * all arrive this way and would otherwise scroll past a green run.
 *
 * Register it as a `setupFiles` entry on the projects it should guard; a file
 * that imports {@link expectConsole} arms it for itself either way, since these
 * hooks register when the module is evaluated.
 */

export type ConsoleLevel = 'error' | 'warn'

type ConsoleSpy = MockInstance<(...args: unknown[]) => void>

const LEVELS: readonly ConsoleLevel[] = ['error', 'warn']

const spies = new Map<ConsoleLevel, ConsoleSpy>()
/** Substrings the test under way has claimed, per level. */
const claims = new Map<ConsoleLevel, string[]>()

/**
 * Claims console output the current test is supposed to produce: calls whose
 * text contains one of `substrings` pass, and every substring must match at
 * least one call, so a claim cannot outlive the behaviour it covers. Call it
 * before the output happens; the returned spy is the one recording it, for
 * asserting on the arguments themselves.
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
