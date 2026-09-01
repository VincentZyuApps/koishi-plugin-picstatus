export type MetricResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'unavailable' | 'unsupported' | 'error'; message: string }

export interface UsageMetric {
  percent: number | null
  used: number
  total: number
}

export type MemoryPlatform = 'linux' | 'android' | 'windows' | 'macos' | 'other'
export type MemorySegmentKind = 'used' | 'shared' | 'compressed' | 'buffers' | 'cache'

export interface MemorySegment {
  kind: MemorySegmentKind
  value: number
}

export interface MemoryMetric extends UsageMetric {
  platform: MemoryPlatform
  free: number
  available: number
  reportedUsed: number
  shared: number
  buffers: number
  cache: number
  buffCache: number
  compressed: number
  segments: MemorySegment[]
}

export interface SwapMetric extends UsageMetric {
  free: number
  cached: number
  reportedUsed: number
}

export interface CpuMetric {
  brand: string
  physicalCores: number
  logicalCores: number
  speed: number | null
  percent: number | null
}

export interface DiskUsageMetric {
  name: string
  note?: string
  percent: number | null
  used: number
  total: number
  error?: string
}

export interface IoMetric {
  name: string
  read: number
  write: number
}

export interface NetworkMetric {
  name: string
  sent: number
  received: number
}

export interface SiteMetric {
  name: string
  status?: number
  statusText?: string
  delay?: number
  error?: string
}

export interface ProcessMetric {
  name: string
  cpu: number
  memory: number
}

export interface BotMetric {
  key: string
  platform: string
  selfId: string
  name: string
  avatar?: string
  status: string
  connected: number | null
  received: number
  sent: number
}

export interface SystemMetric {
  name: string
  architecture: string
  uptime: number
  container: boolean
}

export interface StatusSnapshot {
  generatedAt: Date
  koishiUptime: number
  system: MetricResult<SystemMetric>
  cpu: MetricResult<CpuMetric>
  memory: MetricResult<MemoryMetric>
  swap: MetricResult<SwapMetric>
  disks: MetricResult<DiskUsageMetric[]>
  diskIo: MetricResult<IoMetric[]>
  networks: MetricResult<NetworkMetric[]>
  sites: MetricResult<SiteMetric[]>
  processes: MetricResult<ProcessMetric[]>
  bots: MetricResult<BotMetric[]>
}

export interface BackgroundData {
  data: Buffer | null
  mime: string
  source: string
}
