import assert from 'node:assert/strict'
import test from 'node:test'
import { usage } from '../src/usage'

test('usage gives every collapsible section a theme-aware panel', () => {
  assert.equal(usage.match(/<details style=/g)?.length, 5)
  assert.equal(usage.match(/<summary style=/g)?.length, 5)
  assert.equal(usage.match(/<div style=/g)?.length, 5)

  for (const variable of ['--k-color-border', '--k-card-bg', '--k-text-dark', '--k-hover-bg', '--k-color-divider']) {
    assert.match(usage, new RegExp(`var\\(${variable}`))
  }

  assert.match(usage, /border-radius:8px/)
})

test('usage explains memory segment colors across platforms', () => {
  assert.match(usage, /内存与 Swap 颜色图例/)
  assert.match(usage, /Linux \/ Termux\(Android\) 详细模式/)
  assert.match(usage, /Windows MEM \/ RAM/)
  assert.match(usage, /macOS \/ 通用平台 MEM \/ RAM/)
  assert.match(usage, /所有平台 SWAP \/ SWP/)

  for (const color of ['#38A64B', '#9676CE', '#666D75', '#2594C7', '#D4AA2A', '#C7C7C7', '#DB5B64']) {
    assert.match(usage, new RegExp(`background:${color}`, 'i'))
  }

  assert.match(usage, /红色是 used 类别色，不是告警/)
  assert.match(usage, /色段长度.*占总量的比例/)
})

test('usage describes current platform and disk presentation behavior', () => {
  assert.match(usage, /Termux\/Android 与容器环境/)
  assert.match(usage, /Linux\/macOS 的真实设备显示.*虚拟文件系统反向显示/)
  assert.match(usage, /Termux\/Android 显示“挂载路径 \+ 逻辑设备”/)
  assert.match(usage, /完整配置与行为说明请查看插件 README/)
  assert.doesNotMatch(usage, /完整配置与故障排查/)
})
