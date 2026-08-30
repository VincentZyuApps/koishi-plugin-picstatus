export function clampPercent(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, value))
}

export function formatBytes(value: number, suffix = ''): string {
  if (!Number.isFinite(value) || value < 0) return `未知${suffix}`
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let current = value
  let index = 0
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024
    index++
  }
  const digits = index === 0 ? 0 : current >= 100 ? 0 : current >= 10 ? 1 : 2
  return `${current.toFixed(digits)}${units[index]}${suffix}`
}

export function formatGiB(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '未知'
  return `${(value / 1024 ** 3).toFixed(2)}G`
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '未知'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor(seconds % 86400 / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  const secs = Math.floor(seconds % 60)
  return [days && `${days}天`, hours && `${hours}时`, minutes && `${minutes}分`, `${secs}秒`]
    .filter(Boolean).join('')
}

export function formatFrequency(ghz: number | null): string {
  return ghz && Number.isFinite(ghz) ? `${ghz.toFixed(2)}GHz` : '未知频率'
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[char]!)
}
