import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format an ISO date string as compact relative time.
 * Examples: "30s", "1m40s", "1h15m", "1d10h", "3w2d", "2mo", "1y3mo"
 */
export function formatRelativeCompact(isoDate: string | null | undefined): string {
  if (!isoDate) return ''
  const now = Date.now()
  const then = new Date(isoDate).getTime()
  if (Number.isNaN(then)) return ''
  let diff = Math.max(0, Math.floor((now - then) / 1000))

  const years = Math.floor(diff / (365 * 24 * 3600))
  diff %= 365 * 24 * 3600
  const months = Math.floor(diff / (30 * 24 * 3600))
  diff %= 30 * 24 * 3600
  const weeks = Math.floor(diff / (7 * 24 * 3600))
  diff %= 7 * 24 * 3600
  const days = Math.floor(diff / (24 * 3600))
  diff %= 24 * 3600
  const hours = Math.floor(diff / 3600)
  diff %= 3600
  const minutes = Math.floor(diff / 60)
  const seconds = diff % 60

  if (years > 0) return months > 0 ? `${years}y${months}mo` : `${years}y`
  if (months > 0) return `${months}mo`
  if (weeks > 0) return days > 0 ? `${weeks}w${days}d` : `${weeks}w`
  if (days > 0) return hours > 0 ? `${days}d${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`
  if (minutes > 0) return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`
  return `${seconds}s`
}

/**
 * Format an ISO date string as "YYYY-MM-DD HH:mm:ss".
 */
export function formatAbsoluteDate(isoDate: string | null | undefined): string {
  if (!isoDate) return ''
  const d = new Date(isoDate)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Format an ISO date string as verbose relative time.
 * Examples: "1 hour 15 mins ago", "3 days 10 hours ago", "just now"
 */
export function formatVerboseRelative(isoDate: string | null | undefined): string {
  if (!isoDate) return ''
  const now = Date.now()
  const then = new Date(isoDate).getTime()
  if (Number.isNaN(then)) return ''
  let diff = Math.max(0, Math.floor((now - then) / 1000))

  const years = Math.floor(diff / (365 * 24 * 3600))
  diff %= 365 * 24 * 3600
  const months = Math.floor(diff / (30 * 24 * 3600))
  diff %= 30 * 24 * 3600
  const days = Math.floor(diff / (24 * 3600))
  diff %= 24 * 3600
  const hours = Math.floor(diff / 3600)
  diff %= 3600
  const minutes = Math.floor(diff / 60)
  const seconds = diff % 60

  const parts: string[] = []
  if (years > 0) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`)
  if (months > 0) parts.push(`${months} ${months === 1 ? 'month' : 'months'}`)
  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`)
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`)
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'min' : 'mins'}`)
  if (parts.length === 0) return seconds > 0 ? `${seconds} ${seconds === 1 ? 'sec' : 'secs'} ago` : 'just now'

  return `${parts.slice(0, 2).join(' ')} ago`
}

/**
 * Build a tooltip string showing created and modified dates
 * with both absolute timestamps and verbose relative times.
 */
export function buildDateTooltip(created: string | null | undefined, modified: string | null | undefined): string {
  const lines: string[] = []
  if (created) {
    lines.push(`Created at: ${formatAbsoluteDate(created)} (${formatVerboseRelative(created)})`)
  }
  if (modified) {
    lines.push(`Modified at: ${formatAbsoluteDate(modified)} (${formatVerboseRelative(modified)})`)
  }
  return lines.join('\n')
}
