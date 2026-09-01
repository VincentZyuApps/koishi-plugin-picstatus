import assert from 'node:assert/strict'
import test from 'node:test'
import type si from 'systeminformation'
import {
  DiskMetadataCache,
  diskMatchesIgnored,
  enrichDiskIdentity,
  selectDiskLabel,
  selectDiskPresentation,
} from '../src/collectors/storage'
import { compilePatterns } from '../src/utils/filter'

type FsDisk = Awaited<ReturnType<typeof si.fsSize>>[number]
type BlockDevice = Awaited<ReturnType<typeof si.blockDevices>>[number]

function fsDisk(fs: string, mount: string, size = 1000): FsDisk {
  return { fs, mount, size, used: size / 2, available: size / 2, use: 50, type: 'test', rw: true }
}

function block(overrides: Partial<BlockDevice>): BlockDevice {
  return {
    name: '', identifier: '', type: 'part', fsType: '', mount: '', size: 0,
    physical: '', uuid: '', label: '', model: '', serial: '', removable: false,
    protocol: '', device: '', ...overrides,
  }
}

test('automatic disk labels and notes follow platform semantics', () => {
  assert.deepEqual(selectDiskPresentation({
    fs: 'C:', mount: 'C:', label: 'C-系统盘-SSD', physical: '\\\\.\\PHYSICALDRIVE5',
  }, 'auto', 'auto', 'win32'), { name: 'C:', note: 'C-系统盘-SSD' })
  assert.deepEqual(selectDiskPresentation({ fs: '/dev/nvme0n1p2', mount: '/' }, 'auto', 'auto', 'linux'), {
    name: '/dev/nvme0n1p2', note: '/',
  })
  assert.deepEqual(selectDiskPresentation({ fs: 'overlay', mount: '/var/lib/docker/overlay2/layer' }, 'auto', 'auto', 'linux'), {
    name: '/var/lib/docker/overlay2/layer', note: 'overlay',
  })
  assert.deepEqual(selectDiskPresentation({ fs: '/dev/disk3s1s1', mount: '/' }, 'auto', 'auto', 'darwin'), {
    name: '/dev/disk3s1s1', note: '/',
  })
  assert.deepEqual(selectDiskPresentation({ fs: '/dev/block/dm-5', mount: '/data' }, 'auto', 'auto', 'android'), {
    name: '/data', note: '/dev/block/dm-5',
  })
})

test('five identity modes remain explicit and fall back to distinct values', () => {
  const identity = {
    fs: '/dev/sda1', mount: '/boot', label: 'EFI', physical: '/dev/sda',
  }
  assert.equal(selectDiskLabel(identity, 'device', 'linux'), '/dev/sda1')
  assert.equal(selectDiskLabel(identity, 'mount', 'linux'), '/boot')
  assert.equal(selectDiskLabel(identity, 'label', 'linux'), 'EFI')
  assert.equal(selectDiskLabel(identity, 'physical', 'linux'), '/dev/sda')
  assert.deepEqual(selectDiskPresentation(identity, 'device', 'none', 'linux'), { name: '/dev/sda1' })

  const logs: string[] = []
  assert.deepEqual(selectDiskPresentation({
    fs: 'C:', mount: 'C:', physical: '\\\\.\\PHYSICALDRIVE5',
  }, 'auto', 'auto', 'win32', (message) => logs.push(message)), {
    name: 'C:', note: '\\\\.\\PHYSICALDRIVE5',
  })
  assert.match(logs[0], /未获取到卷标.*回退到物理设备/)
})

test('duplicate or unavailable note values are hidden with a diagnostic', () => {
  const logs: string[] = []
  assert.deepEqual(selectDiskPresentation({ fs: 'C:', mount: 'C:' }, 'auto', 'auto', 'win32', (message) => logs.push(message)), {
    name: 'C:', note: undefined,
  })
  assert.match(logs[0], /未获取到卷标.*隐藏注释/)
})

test('block metadata is associated by mount or logical device', () => {
  assert.deepEqual(enrichDiskIdentity(fsDisk('C:', 'C:', 1000), [block({
    name: 'C:', identifier: 'C:', mount: 'C:', size: 1000,
    label: 'System', device: '\\\\.\\PHYSICALDRIVE5',
  })]), {
    fs: 'C:', mount: 'C:', label: 'System', physical: '\\\\.\\PHYSICALDRIVE5',
  })
  assert.deepEqual(enrichDiskIdentity(fsDisk('/dev/sdb2', '/', 2000), [block({
    name: 'sdb2', mount: '/', size: 2000, label: 'rootfs', device: '/dev/sdb',
  })]), {
    fs: '/dev/sdb2', mount: '/', label: 'rootfs', physical: '/dev/sdb',
  })
})

test('disk ignore patterns match every raw identity field', () => {
  const ignored = compilePatterns(['^/dev/loop', '^/boot$', 'secret', 'PHYSICALDRIVE5'])
  assert.equal(diskMatchesIgnored({ fs: '/dev/loop0', mount: '/snap/test' }, ignored), true)
  assert.equal(diskMatchesIgnored({ fs: '/dev/sda1', mount: '/boot' }, ignored), true)
  assert.equal(diskMatchesIgnored({ fs: 'C:', mount: 'C:', label: 'secret volume' }, ignored), true)
  assert.equal(diskMatchesIgnored({ fs: 'C:', mount: 'C:', physical: '\\\\.\\PHYSICALDRIVE5' }, ignored), true)
  assert.equal(diskMatchesIgnored({ fs: '/dev/sda2', mount: '/' }, ignored), false)
})

test('disk metadata is cached and refreshed when disks or TTL change', async () => {
  let now = 1000
  let calls = 0
  const data = [block({ name: 'C:', mount: 'C:' })]
  const cache = new DiskMetadataCache(async () => { calls++; return data }, () => now)
  assert.equal(await cache.get('C:', 100), data)
  assert.equal(await cache.get('C:', 100), data)
  assert.equal(calls, 1)

  now += 5 * 60_000 + 1
  await cache.get('C:', 100)
  assert.equal(calls, 2)
  await cache.get('D:', 100)
  assert.equal(calls, 3)
})

test('metadata timeout returns promptly and keeps the background result', async () => {
  let release!: (value: BlockDevice[]) => void
  const cache = new DiskMetadataCache(() => new Promise((resolve) => { release = resolve }))
  const logs: string[] = []
  assert.deepEqual(await cache.get('C:', 5, (message) => logs.push(message)), [])
  assert.match(logs[0], /超过 5ms/)

  const data = [block({ name: 'C:', mount: 'C:' })]
  release(data)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(await cache.get('C:', 5), data)
})

test('an older metadata request cannot overwrite a newer disk set', async () => {
  const releases: Array<(value: BlockDevice[]) => void> = []
  let calls = 0
  const cache = new DiskMetadataCache(() => {
    calls++
    return new Promise((resolve) => releases.push(resolve))
  })
  const first = cache.get('A:', 100)
  const second = cache.get('B:', 100)
  const secondData = [block({ name: 'B:', mount: 'B:' })]
  releases[1](secondData)
  assert.equal(await second, secondData)
  releases[0]([block({ name: 'A:', mount: 'A:' })])
  await first

  assert.equal(await cache.get('B:', 100), secondData)
  assert.equal(calls, 2)
})
