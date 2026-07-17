import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const FIVE_HOUR_WINDOW_MINUTES = 300
const WEEK_WINDOW_MINUTES = 10_080
const MAX_FILES_TO_SCAN = 160
const TAIL_BYTES_PER_FILE = 2 * 1024 * 1024

interface FileCandidate {
  path: string
  modifiedAt: number
}

interface ParsedWindow {
  windowMinutes: number
  usedPercent: number
  resetsAt: Date
  observedAt: Date
}

export interface UsageWindow {
  usedPercent: number
  remainingPercent: number
  resetsAt: Date
  observedAt: Date
}

export interface CodexUsageSnapshot {
  fiveHour: UsageWindow | null
  week: UsageWindow | null
  statusMessage: string
}

export interface ReadCodexUsageOptions {
  sessionsPath?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null
}

function asFiniteNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

function parseWindow(value: unknown, observedAt: Date): ParsedWindow | null {
  const window = asRecord(value)
  if (!window) return null

  const windowMinutes = asFiniteNumber(window.window_minutes)
  const usedPercent = asFiniteNumber(window.used_percent)
  const resetsAtSeconds = asFiniteNumber(window.resets_at)

  if (
    windowMinutes === null ||
    usedPercent === null ||
    resetsAtSeconds === null ||
    (windowMinutes !== FIVE_HOUR_WINDOW_MINUTES && windowMinutes !== WEEK_WINDOW_MINUTES)
  ) {
    return null
  }

  return {
    windowMinutes,
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    resetsAt: new Date(resetsAtSeconds * 1000),
    observedAt,
  }
}

function parseLine(line: string): ParsedWindow[] {
  if (!line.includes('"rate_limits"') || !line.includes('"token_count"')) {
    return []
  }

  try {
    const root = asRecord(JSON.parse(line))
    const payload = asRecord(root?.payload)
    const rateLimits = asRecord(payload?.rate_limits)

    if (root?.type !== 'event_msg' || payload?.type !== 'token_count' || !rateLimits) {
      return []
    }

    const timestamp = typeof root.timestamp === 'string' ? Date.parse(root.timestamp) : Number.NaN
    const observedAt = new Date(Number.isFinite(timestamp) ? timestamp : Date.now())

    return [rateLimits.primary, rateLimits.secondary]
      .map(value => parseWindow(value, observedAt))
      .filter((value): value is ParsedWindow => value !== null)
  } catch {
    return []
  }
}

async function collectSessionFiles(directory: string, files: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })

  await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      try {
        await collectSessionFiles(path, files)
      } catch {
        // Ignore an individual directory that disappears or becomes unreadable.
      }
    } else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      files.push(path)
    }
  }))
}

async function getCandidates(sessionsPath: string): Promise<FileCandidate[]> {
  const paths: string[] = []
  await collectSessionFiles(sessionsPath, paths)

  const candidates = await Promise.all(paths.map(async (path) => {
    try {
      const fileStat = await stat(path)
      return { path, modifiedAt: fileStat.mtimeMs }
    } catch {
      return null
    }
  }))

  return candidates
    .filter((candidate): candidate is FileCandidate => candidate !== null)
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(0, MAX_FILES_TO_SCAN)
}

async function readWindowsFromFile(path: string): Promise<ParsedWindow[]> {
  const file = await open(path, 'r')

  try {
    const fileStat = await file.stat()
    const bytesToRead = Math.min(fileStat.size, TAIL_BYTES_PER_FILE)
    const start = fileStat.size - bytesToRead
    const buffer = Buffer.alloc(bytesToRead)
    const { bytesRead } = await file.read(buffer, 0, bytesToRead, start)
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n')

    // When reading only the tail, the first line may be incomplete JSON.
    if (start > 0) lines.shift()

    return lines.flatMap(line => parseLine(line.trimEnd()))
  } finally {
    await file.close()
  }
}

function toUsageWindow(window: ParsedWindow | null, now: number): UsageWindow | null {
  if (!window || window.resetsAt.getTime() <= now) return null

  return {
    usedPercent: window.usedPercent,
    remainingPercent: Math.min(100, Math.max(0, 100 - window.usedPercent)),
    resetsAt: window.resetsAt,
    observedAt: window.observedAt,
  }
}

export async function readCodexUsage(
  options: ReadCodexUsageOptions = {},
): Promise<CodexUsageSnapshot> {
  const sessionsPath = options.sessionsPath ?? join(homedir(), '.codex', 'sessions')
  let candidates: FileCandidate[]

  try {
    candidates = await getCandidates(sessionsPath)
  } catch (error) {
    const code = asRecord(error)?.code
    return {
      fiveHour: null,
      week: null,
      statusMessage: code === 'ENOENT'
        ? '未找到 Codex 本地会话目录'
        : '无法读取 Codex 本地会话目录',
    }
  }

  let fiveHour: ParsedWindow | null = null
  let week: ParsedWindow | null = null

  for (const candidate of candidates) {
    let windows: ParsedWindow[]

    try {
      windows = await readWindowsFromFile(candidate.path)
    } catch {
      continue
    }

    for (const window of windows) {
      if (
        window.windowMinutes === FIVE_HOUR_WINDOW_MINUTES &&
        (!fiveHour || window.observedAt > fiveHour.observedAt)
      ) {
        fiveHour = window
      } else if (
        window.windowMinutes === WEEK_WINDOW_MINUTES &&
        (!week || window.observedAt > week.observedAt)
      ) {
        week = window
      }
    }
  }

  const now = Date.now()
  const currentFiveHour = toUsageWindow(fiveHour, now)
  const currentWeek = toUsageWindow(week, now)

  return {
    fiveHour: currentFiveHour,
    week: currentWeek,
    statusMessage: currentFiveHour || currentWeek
      ? '同步成功'
      : '本地日志中暂无有效额度数据',
  }
}
