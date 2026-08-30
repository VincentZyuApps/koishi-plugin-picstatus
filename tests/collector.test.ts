import assert from 'node:assert/strict'
import test from 'node:test'
import { collectCpu, collectMemory, collectSystem, memoryFromSystemInformation, parseLinuxMeminfo } from '../src/collectors/system'

const KIB = 1024

const linuxMeminfo = `
MemTotal:       16157472 kB
MemFree:          282884 kB
MemAvailable:   12205660 kB
Buffers:          100000 kB
Cached:         12000000 kB
SReclaimable:     273048 kB
Shmem:            110572 kB
Zswap:                 0 kB
SwapCached:          1000 kB
SwapTotal:       16777212 kB
SwapFree:        12967164 kB
`

test('systeminformation collectors return usable host data', async () => {
  const [system, cpu, memory] = await Promise.all([collectSystem(), collectCpu(), collectMemory()])
  assert.ok(system.name)
  assert.ok(system.architecture)
  assert.ok(system.uptime >= 0)
  assert.ok(cpu.logicalCores > 0)
  assert.ok(cpu.brand)
  assert.ok(memory.memory.total > 0)
  assert.ok(memory.memory.used >= 0)
})

test('Linux memory follows htop classes while preserving free-style totals', () => {
  const { memory, swap } = parseLinuxMeminfo(linuxMeminfo)
  assert.equal(memory.total, 16157472 * KIB)
  assert.equal(memory.reportedUsed, 3501540 * KIB)
  assert.equal(memory.shared, 110572 * KIB)
  assert.equal(memory.used, 3612112 * KIB)
  assert.equal(memory.buffCache, 12373048 * KIB)
  assert.equal(memory.segments.reduce((sum, item) => sum + item.value, 0), memory.total - memory.free)
  assert.ok(memory.percent != null && Math.abs(memory.percent - 22.355) < 0.01)
  assert.equal(swap.reportedUsed, 3810048 * KIB)
  assert.equal(swap.cached, 1000 * KIB)
  assert.equal(swap.used, 3809048 * KIB)
})

test('Linux memory falls back to MemFree when MemAvailable is absent', () => {
  const { memory } = parseLinuxMeminfo(linuxMeminfo.replace(/^MemAvailable:.*\n/m, ''))
  assert.equal(memory.available, memory.free)
})

test('aggregate platform adapters avoid invented Windows classes', () => {
  const data = {
    total: 1000, free: 400, used: 600, active: 600, available: 400,
    buffers: 0, cached: 0, slab: 0, buffcache: 0, reclaimable: 0,
    swaptotal: 500, swapused: 100, swapfree: 400, writeback: null, dirty: null,
  }
  const windows = memoryFromSystemInformation(data, 'win32')
  assert.equal(windows.memory.platform, 'windows')
  assert.deepEqual(windows.memory.segments, [{ kind: 'used', value: 600 }])

  const mac = memoryFromSystemInformation({ ...data, free: 100, available: 400, active: 600, buffcache: 300 }, 'darwin')
  assert.equal(mac.memory.platform, 'macos')
  assert.deepEqual(mac.memory.segments, [{ kind: 'used', value: 600 }, { kind: 'cache', value: 300 }])
})
