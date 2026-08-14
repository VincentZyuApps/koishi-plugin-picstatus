import assert from 'node:assert/strict'
import test from 'node:test'
import { clampPercent, escapeHtml, formatBytes, formatDuration } from '../src/utils/format'
import { compilePatterns, matchesAny } from '../src/utils/filter'

test('format helpers keep stable human-readable output', () => {
  assert.equal(formatBytes(1536), '1.50KiB')
  assert.equal(formatDuration(90061), '1天1时1分1秒')
  assert.equal(clampPercent(120), 100)
  assert.equal(clampPercent(Number.NaN), null)
  assert.equal(escapeHtml('<img src="x">'), '&lt;img src=&quot;x&quot;&gt;')
})

test('regex filters match configured values', () => {
  const patterns = compilePatterns(['^lo$', 'secret'])
  assert.equal(matchesAny('lo', patterns), true)
  assert.equal(matchesAny('Ethernet', patterns), false)
})

