import assert from 'node:assert/strict'
import test from 'node:test'
import type { Config } from '../src/config'
import type { StatusSnapshot } from '../src/types'
import { buildHtml } from '../src/render/template'
import { createView } from '../src/render/view'

export const config = {
  components: ['header', 'cpu', 'disk', 'network', 'process', 'footer'],
  imageWidth: 650,
  theme: 'light', disableBlur: false, disableRadius: false, disableShadow: false,
  memoryPercentMode: 'platform', showMemoryBars: true,
  diskLabelMode: 'auto', diskLabelMaxLength: 25, diskNoteMode: 'auto', diskNotePosition: 'below',
} as Config

export const snapshot: StatusSnapshot = {
  generatedAt: new Date('2026-08-14T00:00:00+08:00'), koishiUptime: 65,
  system: { status: 'ok', value: { name: 'Ubuntu 22.04', architecture: 'x64', uptime: 3600, container: false } },
  cpu: { status: 'ok', value: { brand: '<Test CPU>', physicalCores: 8, logicalCores: 16, speed: 4.2, percent: 42 } },
  memory: { status: 'ok', value: {
    platform: 'linux', percent: 25, used: 4e9, reportedUsed: 3.8e9, total: 16e9,
    free: 1e9, available: 11e9, shared: 0.2e9, buffers: 0.1e9, cache: 10.9e9,
    buffCache: 11.2e9, compressed: 0, segments: [
      { kind: 'used', value: 3.8e9 }, { kind: 'shared', value: 0.2e9 },
      { kind: 'compressed', value: 0 }, { kind: 'buffers', value: 0.1e9 },
      { kind: 'cache', value: 10.9e9 },
    ],
  } },
  swap: { status: 'ok', value: { percent: 25, used: 4e9, reportedUsed: 4e9, total: 16e9, free: 12e9, cached: 0 } },
  disks: { status: 'ok', value: [{ name: 'C:', note: 'C-系统盘-SSD-m2接口', percent: 70, used: 70e9, total: 100e9 }] },
  diskIo: { status: 'ok', value: [{ name: '全部磁盘', read: 1024, write: 2048 }] },
  networks: { status: 'ok', value: [{ name: 'Ethernet', sent: 512, received: 4096 }] },
  sites: { status: 'ok', value: [{ name: 'Example', status: 200, statusText: 'OK', delay: 12 }] },
  processes: { status: 'ok', value: [{ name: 'node', cpu: 1.2, memory: 50e6 }] },
  bots: { status: 'ok', value: [{ key: 'test:1', platform: 'test', selfId: '1', name: '<Bot>', status: '1', connected: 60, received: 2, sent: 1 }] },
}

test('default template contains every component and escapes dynamic text', () => {
  const html = buildHtml(createView(snapshot, config), { data: null, mime: '', source: 'builtin' }, config)
  assert.match(html, /class="card resources"/)
  assert.match(html, /class="memory-bars"/)
  assert.match(html, /MEM/)
  assert.match(html, /SWP/)
  assert.match(html, /--ring-gradient:conic-gradient/)
  assert.match(html, /class="grid disk-grid"/)
  assert.match(html, /class="disk-note"/)
  assert.match(html, /└─/)
  assert.match(html, /--canvas-width:650px/)
  assert.match(html, /npm\/github: koishi-plugin-picstatus/)
  assert.match(html, /全部磁盘/)
  assert.match(html, /Ethernet/)
  assert.match(html, /Example/)
  assert.match(html, /&lt;Test CPU&gt;/)
  assert.match(html, /&lt;Bot&gt;/)
  assert.doesNotMatch(html, /<Test CPU>/)
})

test('long disk labels are truncated without sacrificing the capacity bar', () => {
  const name = '/var/lib/docker/overlay2/2e1a8172139bcd5db79186a2dc295023'
  const view = createView({
    ...snapshot,
    disks: { status: 'ok', value: [{ name, percent: 70, used: 70e9, total: 100e9 }] },
  }, config)
  assert.equal(view.disks[0].name, '/var/lib/doc…86a2dc295023')

  const html = buildHtml(view, { data: null, mime: '', source: 'builtin' }, config)
  assert.match(html, /\/var\/lib\/doc…86a2dc295023/)
  assert.match(html, /class="bar-fill medium" style="width:70%"/)
  assert.match(html, /\.disk-entry\{display:grid;grid-template-columns:clamp\(96px,34%,220px\) minmax\(120px,1fr\) 64px/)
})

test('disk notes span the row, preserve both ends and support both positions', () => {
  const note = '/data/docker-runtime/overlay2/0123456789abcdef0123456789abcdef/merged'
  const withNote = {
    ...snapshot,
    disks: { status: 'ok' as const, value: [{ name: 'overlay', note, percent: 50, used: 50e9, total: 100e9 }] },
  }
  const below = buildHtml(createView(withNote, config), { data: null, mime: '', source: 'builtin' }, config)
  assert.ok(below.indexOf('class="disk-row"') < below.indexOf('class="disk-note"'))
  assert.match(below, /class="disk-note" title="\/data\/docker-runtime/)
  assert.match(below, /class="disk-note-head">\/data\/docker-runtime/)
  assert.match(below, /class="disk-note-tail">[0-9a-f]+\/merged/)
  assert.match(below, /grid-column:1\/-1/)

  const aboveConfig = { ...config, diskNotePosition: 'above' as const }
  const above = buildHtml(createView(withNote, aboveConfig), { data: null, mime: '', source: 'builtin' }, aboveConfig)
  assert.ok(above.indexOf('class="disk-note"') < above.indexOf('class="disk-row"'))
  assert.match(above, /┌─/)
})

test('disk note content is escaped without a character limit', () => {
  const note = '<unsafe>&'.repeat(20)
  const view = createView({
    ...snapshot,
    disks: { status: 'ok', value: [{ name: 'C:', note, percent: 70, used: 70e9, total: 100e9 }] },
  }, config)
  assert.equal(view.disks[0].note, note)
  const html = buildHtml(view, { data: null, mime: '', source: 'builtin' }, config)
  assert.doesNotMatch(html, /<unsafe>/)
  assert.match(html, /&lt;unsafe&gt;&amp;/)
})

test('RAM percent modes do not alter memory segment lengths', () => {
  const platform = createView(snapshot, config)
  const available = createView(snapshot, { ...config, memoryPercentMode: 'available' })
  const occupied = createView(snapshot, { ...config, memoryPercentMode: 'occupied' })
  assert.equal(platform.memory.percent, 25)
  assert.equal(available.memory.percent, 31.25)
  assert.equal(occupied.memory.percent, 93.75)
  assert.equal(platform.memory.caption, '3.73GiB / 14.9GiB')
  assert.equal(available.memory.caption, '4.66GiB / 14.9GiB')
  assert.equal(occupied.memory.caption, '14.0GiB / 14.9GiB')
  assert.equal(platform.memory.captionDetail, '空0.93G 共0.19G 缓10.43G 可10.24G')
  assert.deepEqual(platform.memory.segments, available.memory.segments)
  assert.deepEqual(platform.memory.segments, occupied.memory.segments)
})

test('RAM and SWAP keep the legacy primary line and put new values on a detail line', () => {
  const view = createView(snapshot, config)
  assert.equal(view.swap.caption, '3.73GiB / 14.9GiB')
  assert.equal(view.swap.captionDetail, '空11.18G')

  const html = buildHtml(view, { data: null, mime: '', source: 'builtin' }, config)
  assert.match(html, /donut-caption-primary">3\.73GiB \/ 14\.9GiB/)
  assert.match(html, /donut-caption-detail">空0\.93G 共0\.19G 缓10\.43G 可10\.24G/)
})

test('RAM detail lines use only fields supported by each platform', () => {
  const memory = snapshot.memory.status === 'ok' ? snapshot.memory.value : assert.fail('memory fixture unavailable')
  const windows = createView({
    ...snapshot,
    memory: { status: 'ok', value: {
      ...memory, platform: 'windows', total: 8 * 1024 ** 3, used: 6 * 1024 ** 3,
      reportedUsed: 6 * 1024 ** 3, free: 2 * 1024 ** 3, available: 2 * 1024 ** 3,
      shared: 0, buffers: 0, cache: 0, buffCache: 0, compressed: 0,
      segments: [{ kind: 'used', value: 6 * 1024 ** 3 }], percent: 75,
    } },
  }, config)
  assert.equal(windows.memory.caption, '6.00GiB / 8.00GiB')
  assert.equal(windows.memory.captionDetail, '可2.00G')
  assert.deepEqual(windows.memoryBars[0].segments, [{ kind: 'used', percent: 75 }])

  const macos = createView({
    ...snapshot,
    memory: { status: 'ok', value: {
      ...memory, platform: 'macos', total: 8 * 1024 ** 3, used: 4 * 1024 ** 3,
      reportedUsed: 4 * 1024 ** 3, free: 1 * 1024 ** 3, available: 3 * 1024 ** 3,
      shared: 0, buffers: 0, cache: 2 * 1024 ** 3, buffCache: 2 * 1024 ** 3, compressed: 0,
      segments: [{ kind: 'used', value: 4 * 1024 ** 3 }, { kind: 'cache', value: 2 * 1024 ** 3 }], percent: 50,
    } },
  }, config)
  assert.equal(macos.memory.caption, '4.00GiB / 8.00GiB')
  assert.equal(macos.memory.captionDetail, '空1.00G 缓2.00G 可3.00G')
  assert.deepEqual(macos.memoryBars[0].segments, [
    { kind: 'used', percent: 50 },
    { kind: 'cache', percent: 25 },
  ])
})

test('Android procfs and generic platforms both expose memory bars', () => {
  const memory = snapshot.memory.status === 'ok' ? snapshot.memory.value : assert.fail('memory fixture unavailable')
  const android = createView({
    ...snapshot,
    memory: { status: 'ok', value: { ...memory, platform: 'android' } },
  }, config)
  assert.equal(android.memoryBars.length, 2)
  assert.equal(android.memory.captionDetail, '空0.93G 共0.19G 缓10.43G 可10.24G')
  assert.deepEqual(android.memoryBars[0].segments.map((item) => item.kind), ['used', 'shared', 'compressed', 'buffers', 'cache'])

  const generic = createView({
    ...snapshot,
    memory: { status: 'ok', value: {
      ...memory, platform: 'other', shared: 0, buffers: 0, compressed: 0,
      used: 6 * 1024 ** 3, total: 10 * 1024 ** 3, free: 2 * 1024 ** 3,
      available: 4 * 1024 ** 3, cache: 2 * 1024 ** 3, buffCache: 2 * 1024 ** 3,
      segments: [{ kind: 'used', value: 6 * 1024 ** 3 }, { kind: 'cache', value: 2 * 1024 ** 3 }],
    } },
  }, config)
  assert.deepEqual(generic.memoryBars[0].segments, [
    { kind: 'used', percent: 60 },
    { kind: 'cache', percent: 20 },
  ])
})

test('unavailable memory and unconfigured SWAP have no detail line', () => {
  const view = createView({
    ...snapshot,
    memory: { status: 'unavailable', message: 'test' },
    swap: { status: 'ok', value: { percent: null, used: 0, reportedUsed: 0, total: 0, free: 0, cached: 0 } },
  }, config)
  assert.equal(view.memory.caption, '未部署')
  assert.equal(view.memory.captionDetail, undefined)
  assert.equal(view.swap.caption, '未配置')
  assert.equal(view.swap.captionDetail, undefined)
  assert.equal(view.memoryBars.length, 0)
})

test('global memory bar switch removes only the full-width bars', () => {
  const view = createView(snapshot, { ...config, showMemoryBars: false })
  assert.equal(view.memoryBars.length, 0)
  assert.equal(view.memory.segments.length, 5)
})

test('unconfigured SWAP keeps its row when memory bars are enabled', () => {
  const view = createView({
    ...snapshot,
    swap: { status: 'ok', value: { percent: null, used: 0, reportedUsed: 0, total: 0, free: 0, cached: 0 } },
  }, config)
  assert.equal(view.memoryBars.length, 2)
  assert.equal(view.memoryBars[1].value, '未配置')
  assert.deepEqual(view.memoryBars[1].segments, [])
})
