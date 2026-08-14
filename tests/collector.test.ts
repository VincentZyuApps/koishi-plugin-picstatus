import assert from 'node:assert/strict'
import test from 'node:test'
import { collectCpu, collectMemory, collectSystem } from '../src/collectors/system'

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

