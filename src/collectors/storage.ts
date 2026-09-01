import si from 'systeminformation'
import type { Config, DiskIdentityMode, DiskLabelMode, DiskNoteMode } from '../config'
import type { DiskUsageMetric, IoMetric } from '../types'
import { matchesAny } from '../utils/filter'

type FsDisk = Awaited<ReturnType<typeof si.fsSize>>[number]
type BlockDevice = Awaited<ReturnType<typeof si.blockDevices>>[number]
type DiskField = Exclude<DiskIdentityMode, 'auto'>
type Platform = NodeJS.Platform | 'android'
type DiskDiagnostic = (message: string) => void

export interface DiskIdentity {
  fs?: string
  mount?: string
  label?: string
  physical?: string
}

export interface DiskCollectionOptions {
  platform?: Platform
  metadata?: DiskMetadataCache
  debug?: DiskDiagnostic
}

interface SelectedDiskText {
  value: string
  field: DiskField
}

const METADATA_TTL = 5 * 60_000
const METADATA_ERROR_TTL = 60_000
const FIELD_NAMES: Record<DiskField, string> = {
  mount: '挂载路径',
  device: '逻辑设备',
  label: '卷标',
  physical: '物理设备',
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeIdentity(value: string): string {
  const normalized = clean(value).replace(/\\/g, '/')
  if (/^[a-z]:\/?$/i.test(normalized)) return normalized.slice(0, 2).toLowerCase()
  return (normalized === '/' ? normalized : normalized.replace(/\/+$/, '')).toLowerCase()
}

function sameIdentity(left: string, right: string): boolean {
  return Boolean(left && right && normalizeIdentity(left) === normalizeIdentity(right))
}

function diskReference(identity: DiskIdentity): string {
  return clean(identity.mount) || clean(identity.fs) || '未知磁盘'
}

function fieldValue(identity: DiskIdentity, field: DiskField): string {
  return clean(field === 'device' ? identity.fs : identity[field])
}

function mountSignature(disks: FsDisk[]): string {
  return disks
    .map((disk) => `${normalizeIdentity(disk.fs)}|${normalizeIdentity(disk.mount)}`)
    .sort()
    .join(';')
}

export class DiskMetadataCache {
  private data: BlockDevice[] = []
  private signature = ''
  private expiresAt = 0
  private generation = 0
  private pending?: { signature: string; promise: Promise<BlockDevice[]> }

  constructor(
    private load: () => Promise<BlockDevice[]> = () => si.blockDevices(),
    private now: () => number = Date.now,
  ) {}

  async get(signature: string, timeoutMs: number, debug?: DiskDiagnostic): Promise<BlockDevice[]> {
    if (this.signature === signature && this.now() < this.expiresAt) return this.data

    if (!this.pending || this.pending.signature !== signature) {
      const stale = this.signature === signature ? this.data : []
      const generation = ++this.generation
      const promise = this.load().then((data) => {
        const loaded = Array.isArray(data) ? data : []
        if (generation === this.generation) {
          this.data = loaded
          this.signature = signature
          this.expiresAt = this.now() + METADATA_TTL
        }
        return loaded
      }, (error) => {
        if (generation === this.generation) {
          this.data = stale
          this.signature = signature
          this.expiresAt = this.now() + METADATA_ERROR_TTL
        }
        debug?.(`磁盘附加信息采集失败，本次使用基础字段：${error instanceof Error ? error.message : error}`)
        return stale
      })
      this.pending = { signature, promise }
      void promise.finally(() => {
        if (this.pending?.promise === promise) this.pending = undefined
      })
    }

    const pending = this.pending.promise
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        debug?.(`磁盘附加信息采集超过 ${timeoutMs}ms，本次先使用基础字段`)
        resolve(this.signature === signature ? this.data : [])
      }, timeoutMs)
      void pending.then((data) => {
        clearTimeout(timer)
        resolve(data)
      })
    })
  }
}

function blockCandidates(block: BlockDevice): string[] {
  const name = clean(block.name)
  return [
    clean(block.mount),
    name,
    clean(block.identifier),
    name && !name.startsWith('/') ? `/dev/${name}` : '',
  ].filter(Boolean)
}

function matchBlockDevice(disk: FsDisk, blocks: BlockDevice[]): BlockDevice | undefined {
  let best: { block: BlockDevice; score: number } | undefined
  for (const block of blocks) {
    const candidates = blockCandidates(block)
    let score = 0
    if (candidates.some((value) => sameIdentity(disk.fs, value))) score += 8
    if (candidates.some((value) => sameIdentity(disk.mount, value))) score += 8
    if (Number(block.size) > 0 && Number(block.size) === disk.size) score += 1
    if (score > (best?.score ?? 0)) best = { block, score }
  }
  return best?.block
}

export function enrichDiskIdentity(disk: FsDisk, blocks: BlockDevice[]): DiskIdentity {
  const block = matchBlockDevice(disk, blocks)
  return {
    fs: clean(disk.fs),
    mount: clean(disk.mount),
    label: clean(block?.label),
    physical: clean(block?.device),
  }
}

export function diskMatchesIgnored(disk: DiskIdentity, ignored: RegExp[]): boolean {
  return [disk.fs, disk.mount, disk.label, disk.physical]
    .some((value) => Boolean(value && matchesAny(value, ignored)))
}

function automaticField(
  identity: DiskIdentity,
  role: 'label' | 'note',
  platform: Platform,
  primary?: SelectedDiskText,
): DiskField {
  if (role === 'note') {
    if (platform === 'win32') return 'label'
    return primary?.field === 'mount' ? 'device' : 'mount'
  }
  if (platform === 'win32' || platform === 'android') return 'mount'
  if ((platform === 'linux' || platform === 'darwin') && /^\/dev(?:\/|$)/.test(clean(identity.fs))) return 'device'
  return 'mount'
}

function fallbackFields(requested: DiskField): DiskField[] {
  switch (requested) {
    case 'mount': return ['mount', 'device', 'label', 'physical']
    case 'device': return ['device', 'mount', 'label', 'physical']
    case 'label': return ['label', 'device', 'mount', 'physical']
    case 'physical': return ['physical', 'device', 'mount', 'label']
  }
}

function selectDiskText(
  identity: DiskIdentity,
  mode: DiskIdentityMode,
  role: 'label' | 'note',
  platform: Platform,
  primary?: SelectedDiskText,
  debug?: DiskDiagnostic,
): SelectedDiskText | undefined {
  const requested = mode === 'auto' ? automaticField(identity, role, platform, primary) : mode
  const requestedValue = fieldValue(identity, requested)
  const selected = fallbackFields(requested).map((field) => ({
    field,
    value: fieldValue(identity, field),
  })).find((item) => item.value && (!primary || !sameIdentity(item.value, primary.value)))

  const reference = diskReference(identity)
  if (!selected) {
    if (role === 'note') {
      const reason = requestedValue ? '与主标签重复' : '未获取到'
      debug?.(`磁盘 ${reference} 的注释${reason}${FIELD_NAMES[requested]}，已隐藏注释`)
    }
    return undefined
  }
  if (selected.field !== requested) {
    const reason = requestedValue ? '与主标签重复' : '未获取到'
    debug?.(`磁盘 ${reference} 的${role === 'label' ? '主标签' : '注释'}${reason}${FIELD_NAMES[requested]}，已回退到${FIELD_NAMES[selected.field]}：${selected.value}`)
  }
  return selected
}

export function selectDiskPresentation(
  identity: DiskIdentity,
  labelMode: DiskLabelMode,
  noteMode: DiskNoteMode,
  platform: Platform = process.platform,
  debug?: DiskDiagnostic,
): Pick<DiskUsageMetric, 'name' | 'note'> {
  const label = selectDiskText(identity, labelMode, 'label', platform, undefined, debug)
    ?? { value: '未知磁盘', field: 'device' as const }
  if (noteMode === 'none') return { name: label.value }
  const note = selectDiskText(identity, noteMode, 'note', platform, label, debug)
  return { name: label.value, note: note?.value }
}

export function selectDiskLabel(
  disk: DiskIdentity,
  mode: DiskLabelMode,
  platform: Platform = process.platform,
): string {
  return selectDiskPresentation(disk, mode, 'none', platform).name
}

function needsMetadata(config: Config, ignored: RegExp[], platform: Platform): boolean {
  const modes = [config.diskLabelMode, config.diskNoteMode]
  return ignored.length > 0
    || modes.some((mode) => mode === 'label' || mode === 'physical')
    || (platform === 'win32' && config.diskNoteMode === 'auto')
}

export async function collectDisks(
  config: Config,
  ignored: RegExp[],
  options: DiskCollectionOptions = {},
): Promise<DiskUsageMetric[]> {
  const platform = options.platform ?? process.platform
  const disks = await si.fsSize()
  const timeoutMs = Math.max(1, Math.min(3000, config.collectTimeout * 500))
  const blocks = needsMetadata(config, ignored, platform)
    ? await (options.metadata ?? new DiskMetadataCache()).get(mountSignature(disks), timeoutMs, options.debug)
    : []
  const result = disks.map((disk) => ({ disk, identity: enrichDiskIdentity(disk, blocks) }))
    .filter(({ identity }) => !diskMatchesIgnored(identity, ignored))
    .map(({ disk, identity }) => ({
      ...selectDiskPresentation(identity, config.diskLabelMode, config.diskNoteMode, platform, options.debug),
      percent: Number.isFinite(disk.use) ? disk.use : null,
      used: disk.used,
      total: disk.size,
    }))
  return result.sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1))
}

export async function collectDiskIo(config: Config): Promise<IoMetric[]> {
  const io = await si.fsStats()
  const result = [{ name: '全部磁盘', read: io.rx_sec ?? 0, write: io.wx_sec ?? 0 }]
  return config.hideIdleIo ? result.filter((item) => item.read || item.write) : result
}
