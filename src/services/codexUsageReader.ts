import { open, readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join } from "node:path"

const FIVE_HOUR_WINDOW_MINUTES = 300
const WEEK_WINDOW_MINUTES = 10_080
const MAX_FILES_TO_SCAN = 160
const TAIL_BYTES_PER_FILE = 2 * 1024 * 1024
const HEAD_BYTES_PER_FILE = 256 * 1024

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

interface ParsedTokenUsage {
  inputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
  observedAt: Date
}

interface ParsedSessionInfo {
  sessionId: string | null
  cwd: string | null
}

interface ParsedModel {
  name: string
  observedAt: Date
}

interface ParsedLogEntry {
  windows: ParsedWindow[]
  tokenUsage: ParsedTokenUsage | null
  sessionInfo: ParsedSessionInfo | null
  model: ParsedModel | null
}

export interface UsageWindow {
  usedPercent: number
  remainingPercent: number
  resetsAt: Date
  observedAt: Date
}

export interface TokenUsageSummary {
  inputTokens: number
  cachedInputTokens: number
  cacheWriteInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
  sessionCount: number
  observedAt: Date
}

export interface UsageBreakdownItem {
  name: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  sessionCount: number
}

export interface CodexUsageSnapshot {
  fiveHour: UsageWindow | null
  week: UsageWindow | null
  tokens: TokenUsageSummary | null
  projectUsage: UsageBreakdownItem[]
  modelUsage: UsageBreakdownItem[]
  statusMessage: string
}

export interface ReadCodexUsageOptions {
  sessionsPath?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null
}

function asFiniteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value)
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

function parseTokenUsage(value: unknown, observedAt: Date): ParsedTokenUsage | null {
  const usage = asRecord(value)
  if (!usage) return null

  const inputTokens = asFiniteNumber(usage.input_tokens)
  const outputTokens = asFiniteNumber(usage.output_tokens)
  if (inputTokens === null || outputTokens === null) return null

  const cachedInputTokens = asFiniteNumber(usage.cached_input_tokens) ?? 0
  const cacheWriteInputTokens = asFiniteNumber(usage.cache_write_input_tokens) ?? 0
  const reasoningOutputTokens = asFiniteNumber(usage.reasoning_output_tokens) ?? 0
  const totalTokens = asFiniteNumber(usage.total_tokens) ?? inputTokens + outputTokens

  return {
    inputTokens: Math.max(0, inputTokens),
    cachedInputTokens: Math.max(0, cachedInputTokens),
    cacheWriteInputTokens: Math.max(0, cacheWriteInputTokens),
    outputTokens: Math.max(0, outputTokens),
    reasoningOutputTokens: Math.max(0, reasoningOutputTokens),
    totalTokens: Math.max(0, totalTokens),
    observedAt,
  }
}

function parseLine(line: string): ParsedLogEntry | null {
  if (!line.includes('"type"')) return null

  try {
    const root = asRecord(JSON.parse(line))
    if (!root) return null
    const payload = asRecord(root?.payload)
    const timestamp = typeof root.timestamp === "string" ? Date.parse(root.timestamp) : Number.NaN
    const observedAt = new Date(Number.isFinite(timestamp) ? timestamp : Date.now())

    if (root?.type === "session_meta") {
      const sessionId = typeof payload?.session_id === "string" ? payload.session_id : null
      const cwd = typeof payload?.cwd === "string" ? payload.cwd : null
      return {
        windows: [],
        tokenUsage: null,
        sessionInfo: { sessionId, cwd },
        model: null,
      }
    }

    if (root?.type === "turn_context" && typeof payload?.model === "string") {
      return {
        windows: [],
        tokenUsage: null,
        sessionInfo: null,
        model: { name: payload.model, observedAt },
      }
    }

    if (root?.type !== "event_msg" || payload?.type !== "token_count") return null
    const rateLimits = asRecord(payload?.rate_limits)

    return {
      windows: rateLimits
        ? [rateLimits.primary, rateLimits.secondary]
            .map((value) => parseWindow(value, observedAt))
            .filter((value): value is ParsedWindow => value !== null)
        : [],
      tokenUsage: parseTokenUsage(asRecord(payload?.info)?.total_token_usage, observedAt),
      sessionInfo: null,
      model: null,
    }
  } catch {
    return null
  }
}

async function collectSessionFiles(directory: string, files: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })

  await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)

      if (entry.isDirectory()) {
        try {
          await collectSessionFiles(path, files)
        } catch {
          // Ignore an individual directory that disappears or becomes unreadable.
        }
      } else if (
        entry.isFile() &&
        entry.name.startsWith("rollout-") &&
        entry.name.endsWith(".jsonl")
      ) {
        files.push(path)
      }
    }),
  )
}

async function getCandidates(sessionsPath: string): Promise<FileCandidate[]> {
  const paths: string[] = []
  await collectSessionFiles(sessionsPath, paths)

  const candidates = await Promise.all(
    paths.map(async (path) => {
      try {
        const fileStat = await stat(path)
        return { path, modifiedAt: fileStat.mtimeMs }
      } catch {
        return null
      }
    }),
  )

  return candidates
    .filter((candidate): candidate is FileCandidate => candidate !== null)
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(0, MAX_FILES_TO_SCAN)
}

async function readLogEntriesFromFile(path: string): Promise<ParsedLogEntry[]> {
  const file = await open(path, "r")

  try {
    const fileStat = await file.stat()
    const ranges =
      fileStat.size <= TAIL_BYTES_PER_FILE
        ? [{ start: 0, bytes: fileStat.size, discardFirst: false, discardLast: false }]
        : [
            {
              start: 0,
              bytes: Math.min(fileStat.size, HEAD_BYTES_PER_FILE),
              discardFirst: false,
              discardLast: true,
            },
            {
              start: fileStat.size - TAIL_BYTES_PER_FILE,
              bytes: TAIL_BYTES_PER_FILE,
              discardFirst: true,
              discardLast: false,
            },
          ]

    const lines: string[] = []
    for (const range of ranges) {
      const buffer = Buffer.alloc(range.bytes)
      const { bytesRead } = await file.read(buffer, 0, range.bytes, range.start)
      const rangeLines = buffer.subarray(0, bytesRead).toString("utf8").split("\n")
      if (range.discardFirst) rangeLines.shift()
      if (range.discardLast) rangeLines.pop()
      lines.push(...rangeLines)
    }

    return lines
      .map((line) => parseLine(line.trimEnd()))
      .filter((entry): entry is ParsedLogEntry => entry !== null)
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

function addUsage(
  groups: Map<string, UsageBreakdownItem>,
  key: string,
  name: string,
  usage: ParsedTokenUsage,
): void {
  const current = groups.get(key)
  if (current) {
    current.inputTokens += usage.inputTokens
    current.outputTokens += usage.outputTokens
    current.totalTokens += usage.totalTokens
    current.sessionCount += 1
    return
  }

  groups.set(key, {
    name,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    sessionCount: 1,
  })
}

function sortUsage(groups: Map<string, UsageBreakdownItem>): UsageBreakdownItem[] {
  return [...groups.values()].sort((left, right) => right.totalTokens - left.totalTokens)
}

export async function readCodexUsage(
  options: ReadCodexUsageOptions = {},
): Promise<CodexUsageSnapshot> {
  const sessionsPath = options.sessionsPath ?? join(homedir(), ".codex", "sessions")
  let candidates: FileCandidate[]

  try {
    candidates = await getCandidates(sessionsPath)
  } catch (error) {
    const code = asRecord(error)?.code
    return {
      fiveHour: null,
      week: null,
      tokens: null,
      projectUsage: [],
      modelUsage: [],
      statusMessage:
        code === "ENOENT" ? "未找到 Codex 本地会话目录" : "无法读取 Codex 本地会话目录",
    }
  }

  let fiveHour: ParsedWindow | null = null
  let week: ParsedWindow | null = null
  const tokenUsages: ParsedTokenUsage[] = []
  const projectGroups = new Map<string, UsageBreakdownItem>()
  const modelGroups = new Map<string, UsageBreakdownItem>()

  for (const candidate of candidates) {
    let entries: ParsedLogEntry[]

    try {
      entries = await readLogEntriesFromFile(candidate.path)
    } catch {
      continue
    }

    let latestTokenUsage: ParsedTokenUsage | null = null
    let sessionInfo: ParsedSessionInfo | null = null
    const models: ParsedModel[] = []
    for (const entry of entries) {
      for (const window of entry.windows) {
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

      if (
        entry.tokenUsage &&
        (!latestTokenUsage || entry.tokenUsage.observedAt > latestTokenUsage.observedAt)
      ) {
        latestTokenUsage = entry.tokenUsage
      }

      if (entry.sessionInfo) sessionInfo = entry.sessionInfo
      if (entry.model) models.push(entry.model)
    }

    if (latestTokenUsage) {
      tokenUsages.push(latestTokenUsage)

      const cwd = sessionInfo?.cwd ?? "未知项目"
      const projectName = sessionInfo?.cwd ? basename(sessionInfo.cwd) || sessionInfo.cwd : cwd
      addUsage(projectGroups, cwd, projectName, latestTokenUsage)

      const model =
        models
          .filter((item) => item.observedAt <= latestTokenUsage.observedAt)
          .sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime())[0] ??
        models.sort((left, right) => right.observedAt.getTime() - left.observedAt.getTime())[0]
      const modelName = model?.name ?? "未知模型"
      addUsage(modelGroups, modelName, modelName, latestTokenUsage)
    }
  }

  const now = Date.now()
  const currentFiveHour = toUsageWindow(fiveHour, now)
  const currentWeek = toUsageWindow(week, now)
  const tokens = tokenUsages.length
    ? {
        inputTokens: tokenUsages.reduce((total, usage) => total + usage.inputTokens, 0),
        cachedInputTokens: tokenUsages.reduce((total, usage) => total + usage.cachedInputTokens, 0),
        cacheWriteInputTokens: tokenUsages.reduce(
          (total, usage) => total + usage.cacheWriteInputTokens,
          0,
        ),
        outputTokens: tokenUsages.reduce((total, usage) => total + usage.outputTokens, 0),
        reasoningOutputTokens: tokenUsages.reduce(
          (total, usage) => total + usage.reasoningOutputTokens,
          0,
        ),
        totalTokens: tokenUsages.reduce((total, usage) => total + usage.totalTokens, 0),
        sessionCount: tokenUsages.length,
        observedAt: tokenUsages.reduce(
          (latest, usage) => (usage.observedAt > latest ? usage.observedAt : latest),
          tokenUsages[0].observedAt,
        ),
      }
    : null

  return {
    fiveHour: currentFiveHour,
    week: currentWeek,
    tokens,
    projectUsage: sortUsage(projectGroups),
    modelUsage: sortUsage(modelGroups),
    statusMessage:
      currentFiveHour || currentWeek || tokens ? "同步成功" : "本地日志中暂无有效额度数据",
  }
}
