import assert from 'node:assert/strict'
import test from 'node:test'
import { PROCESS_COUNT_DEFAULT, PROCESS_COUNT_MAX, PROCESS_COUNT_MIN, type Config } from '../src/config'
import { OptionError, resolveOptions } from '../src/command'

function config(): Config {
  return {
    processSort: 'cpu',
    processCount: PROCESS_COUNT_DEFAULT,
    theme: 'light',
  } as Config
}

test('empty options preserve global values without mutating config', () => {
  const original = config()
  const resolved = resolveOptions(original, {})
  assert.notEqual(resolved.config, original)
  assert.equal(resolved.config.processSort, 'cpu')
  assert.equal(resolved.config.processCount, PROCESS_COUNT_DEFAULT)
  assert.equal(resolved.config.theme, 'light')
  assert.equal(resolved.recollectProcesses, false)
  assert.deepEqual(original, config())
})

test('sort, count and theme override only this invocation', () => {
  const original = config()
  const resolved = resolveOptions(original, { sort: 'MEMORY', count: PROCESS_COUNT_MAX, theme: 'DARK' })
  assert.equal(resolved.config.processSort, 'memory')
  assert.equal(resolved.config.processCount, PROCESS_COUNT_MAX)
  assert.equal(resolved.config.theme, 'dark')
  assert.equal(resolved.recollectProcesses, true)
  assert.deepEqual(original, config())
})

test('count accepts both boundaries and requests process recollection', () => {
  assert.equal(resolveOptions(config(), { count: PROCESS_COUNT_MIN }).config.processCount, PROCESS_COUNT_MIN)
  assert.equal(resolveOptions(config(), { count: PROCESS_COUNT_MAX }).config.processCount, PROCESS_COUNT_MAX)
  assert.equal(resolveOptions(config(), { count: 1 }).recollectProcesses, true)
})

test('theme alone keeps the process cache', () => {
  const resolved = resolveOptions(config(), { theme: 'dark' })
  assert.equal(resolved.config.theme, 'dark')
  assert.equal(resolved.recollectProcesses, false)
})

test('invalid option values return actionable errors', () => {
  const processCountRange = new RegExp(`${PROCESS_COUNT_MIN}-${PROCESS_COUNT_MAX}`)
  const invalid = [
    { options: { sort: 'disk' }, expected: /cpu 或 memory/ },
    { options: { count: PROCESS_COUNT_MIN - 1 }, expected: processCountRange },
    { options: { count: 1.5 }, expected: processCountRange },
    { options: { count: PROCESS_COUNT_MAX + 1 }, expected: processCountRange },
    { options: { theme: 'auto' }, expected: /light 或 dark/ },
  ]
  for (const item of invalid) {
    assert.throws(
      () => resolveOptions(config(), item.options),
      (error: unknown) => error instanceof OptionError && item.expected.test(error.message),
    )
  }
})
