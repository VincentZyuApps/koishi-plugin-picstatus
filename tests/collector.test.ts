import assert from 'node:assert/strict'
import test from 'node:test'
import si from 'systeminformation'
import { collectProcesses } from '../src/collectors/process'
import { collectCpu, collectMemory, collectSystem, memoryFromSystemInformation, parseLinuxMeminfo } from '../src/collectors/system'
import type { Config } from '../src/config'

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

test('Android procfs uses the same detailed classes as Linux', () => {
  const { memory, swap } = parseLinuxMeminfo(linuxMeminfo, 'android')
  assert.equal(memory.platform, 'android')
  assert.deepEqual(memory.segments.map((item) => item.kind), ['used', 'shared', 'compressed', 'buffers', 'cache'])
  assert.equal(memory.used, 3612112 * KIB)
  assert.equal(swap.used, 3809048 * KIB)
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

  const android = memoryFromSystemInformation({ ...data, active: 0 }, 'android')
  assert.equal(android.memory.platform, 'android')
  assert.deepEqual(android.memory.segments, [{ kind: 'used', value: 600 }, { kind: 'cache', value: 0 }])
})

test('collectProcesses filters out zombie processes by default and keeps them when disabled', async () => {
  const originalProcesses = si.processes
  try {
    si.processes = async () => ({
      all: 2,
      running: 1,
      blocked: 0,
      sleeping: 0,
      unknown: 0,
      list: [
        { pid: 101, parentPid: 1, name: 'node', cpu: 10, cpuu: 5, cpus: 5, mem: 5, priority: 19, memVsz: 1000, memRss: 500, nice: 0, started: '', state: 'running', tty: '', user: 'root', command: 'node', params: '', path: '' },
        { pid: 102, parentPid: 1, name: 'sh]', cpu: 20, cpuu: 10, cpus: 10, mem: 0, priority: 19, memVsz: 0, memRss: 0, nice: 0, started: '', state: 'zombie', tty: '', user: 'root', command: 'sh] <defunct>', params: '', path: '' },
      ],
    } as any)

    // 1. 默认 ignoreZombies（未显式提供或为 true），成功过滤僵尸进程
    const defaultFiltered = await collectProcesses({ processCount: 10, processSort: 'cpu' } as Config, [])
    assert.equal(defaultFiltered.length, 1)
    assert.equal(defaultFiltered[0].name, 'node')

    // 2. 显式开启 ignoreZombies: true
    const explicitFiltered = await collectProcesses({ processCount: 10, processSort: 'cpu', ignoreZombies: true } as Config, [])
    assert.equal(explicitFiltered.length, 1)
    assert.equal(explicitFiltered[0].name, 'node')

    // 3. 显式关闭 ignoreZombies: false，原样保留
    const preserved = await collectProcesses({ processCount: 10, processSort: 'cpu', ignoreZombies: false } as Config, [])
    assert.equal(preserved.length, 2)
    assert.equal(preserved[0].name, 'sh]')
    assert.equal(preserved[1].name, 'node')
  } finally {
    si.processes = originalProcesses
  }
})
