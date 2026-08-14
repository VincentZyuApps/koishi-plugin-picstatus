import assert from 'node:assert/strict'
import test from 'node:test'
import type { Config } from '../src/config'
import type { StatusSnapshot } from '../src/types'
import { buildHtml } from '../src/render/template'
import { createView } from '../src/render/view'

const config = {
  components: ['header', 'cpu', 'disk', 'network', 'process', 'footer'],
  imageWidth: 650,
  theme: 'light', disableBlur: false, disableRadius: false, disableShadow: false,
} as Config

const snapshot: StatusSnapshot = {
  generatedAt: new Date('2026-08-14T00:00:00+08:00'), koishiUptime: 65,
  system: { status: 'ok', value: { name: 'Windows 11', architecture: 'x64', uptime: 3600, container: false } },
  cpu: { status: 'ok', value: { brand: '<Test CPU>', physicalCores: 8, logicalCores: 16, speed: 4.2, percent: 42 } },
  memory: { status: 'ok', value: { percent: 50, used: 8e9, total: 16e9 } },
  swap: { status: 'ok', value: { percent: null, used: 0, total: 0 } },
  disks: { status: 'ok', value: [{ name: 'C:', percent: 70, used: 70e9, total: 100e9 }] },
  diskIo: { status: 'ok', value: [{ name: '全部磁盘', read: 1024, write: 2048 }] },
  networks: { status: 'ok', value: [{ name: 'Ethernet', sent: 512, received: 4096 }] },
  sites: { status: 'ok', value: [{ name: 'Example', status: 200, statusText: 'OK', delay: 12 }] },
  processes: { status: 'ok', value: [{ name: 'node', cpu: 1.2, memory: 50e6 }] },
  bots: { status: 'ok', value: [{ key: 'test:1', platform: 'test', selfId: '1', name: '<Bot>', status: '1', connected: 60, received: 2, sent: 1 }] },
}

test('default template contains every component and escapes dynamic text', () => {
  const html = buildHtml(createView(snapshot), { data: null, mime: '', source: 'builtin' }, config)
  assert.match(html, /class="card donuts"/)
  assert.match(html, /class="grid disk-grid"/)
  assert.match(html, /--canvas-width:650px/)
  assert.match(html, /npm\/github: koishi-plugin-picstatus/)
  assert.match(html, /全部磁盘/)
  assert.match(html, /Ethernet/)
  assert.match(html, /Example/)
  assert.match(html, /&lt;Test CPU&gt;/)
  assert.match(html, /&lt;Bot&gt;/)
  assert.doesNotMatch(html, /<Test CPU>/)
})
