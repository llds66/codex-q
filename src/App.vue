<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Box, Text, onKeyDown, useExit } from 'vue-termui'
import QuotaTab from './components/QuotaTab.vue'
import TokenStatsTab from './components/TokenStatsTab.vue'
import UsageRankingTab from './components/UsageRankingTab.vue'
import {
  readCodexUsage,
  type CodexUsageSnapshot,
  type UsageBreakdownItem,
} from './services/codexUsageReader'
import { theme } from './theme.js'

const exit = useExit()
const usage = ref<CodexUsageSnapshot | null>(null)
const loading = ref(true)
const errorMessage = ref('')
const now = ref(Date.now())
const view = ref<'quota' | 'tokens' | 'project' | 'model'>('quota')
const views: Array<typeof view.value> = ['quota', 'tokens', 'project', 'model']
const projectPage = ref(0)
const projectPageSize = 5
let clock: ReturnType<typeof setInterval> | undefined

const fiveHourProgress = computed(() => usage.value?.fiveHour?.remainingPercent ?? 100)
const weekProgress = computed(() => usage.value?.week?.remainingPercent ?? 0)
const usageItems = computed<UsageBreakdownItem[]>(() =>
  view.value === 'project'
    ? usage.value?.projectUsage ?? []
    : view.value === 'model'
      ? usage.value?.modelUsage ?? []
      : [],
)
const projectPageCount = computed(() =>
  Math.max(1, Math.ceil((usage.value?.projectUsage.length ?? 0) / projectPageSize)),
)
const visibleUsageItems = computed(() =>
  view.value === 'project'
    ? usageItems.value.slice(projectPage.value * projectPageSize, (projectPage.value + 1) * projectPageSize)
    : usageItems.value,
)
const usageMax = computed(() => Math.max(1, ...usageItems.value.map(item => item.totalTokens)))
const usageTitle = computed(() => view.value === 'project' ? '项目用量排行' : '模型用量排行')

const fiveHourLabel = computed(() => {
  if (loading.value && !usage.value) return '五小时额度(读取中...)'
  if (errorMessage.value) return '五小时额度(读取失败)'
  if (!usage.value?.fiveHour) return '五小时额度(∞)'
  return `五小时额度(${Math.round(usage.value.fiveHour.remainingPercent)}%)`
})

const weekLabel = computed(() => {
  if (loading.value && !usage.value) return '一周额度(读取中...)'
  if (errorMessage.value) return '一周额度(读取失败)'
  if (!usage.value?.week) return '一周额度(暂无数据)'
  return `一周额度(${Math.round(usage.value.week.remainingPercent)}%)`
})

function formatResetTime(resetsAt?: Date) {
  if (!resetsAt) return '--'
  const remainingSeconds = Math.max(0, Math.floor((resetsAt.getTime() - now.value) / 1000))
  if (remainingSeconds <= 0) return '--'

  const days = Math.floor(remainingSeconds / 86_400)
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600)
  const minutes = Math.floor((remainingSeconds % 3_600) / 60)
  const seconds = remainingSeconds % 60

  if (days > 0) return `${days}天${hours}时后`
  if (hours > 0) return `${hours}时${minutes}分后`
  return `${minutes}分${seconds}秒后`
}

const fiveHourResetLabel = computed(() =>
  `5h重置时间：${formatResetTime(usage.value?.fiveHour?.resetsAt)}`,
)

const weekResetLabel = computed(() =>
  `7d重置时间：${formatResetTime(usage.value?.week?.resetsAt)}`,
)

const statusMessage = computed(() => {
  if (loading.value) return '正在同步 Codex 额度...'
  return errorMessage.value || usage.value?.statusMessage || '暂无额度数据'
})

const statusColor = computed(() => {
  if (errorMessage.value) return theme.danger
  if (loading.value) return theme.accent
  return theme.muted
})

async function refreshUsage() {
  loading.value = true
  errorMessage.value = ''

  try {
    usage.value = await readCodexUsage()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '读取额度失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void refreshUsage()
  clock = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  if (clock) clearInterval(clock)
})

onKeyDown((key) => {
  if (key.name === 'q') exit()
  else if (key.name === 'tab') {
    key.preventDefault()
    const currentIndex = views.indexOf(view.value)
    const direction = key.shift ? -1 : 1
    view.value = views[(currentIndex + direction + views.length) % views.length]
  }
  else if (view.value === 'project' && (key.name === 'up' || key.name === 'down')) {
    const direction = key.name === 'up' ? -1 : 1
    projectPage.value = (projectPage.value + direction + projectPageCount.value) % projectPageCount.value
  }
  else if (key.name === 'r') {
    void refreshUsage()
  }
})

const hint = computed(() =>
  `Tab 切换页面${view.value === 'project' ? ' · ↑ ↓ 翻页' : ''} · r 刷新数据 · q 退出`,
)
</script>

<template>
  <Box flexDirection="column" :padding="1" :gap="1">
    <Text :fg="theme.primary" bold>> Codex</Text>
    <Box flexDirection="row" :gap="2">
      <Text :fg="view === 'quota' ? theme.primary : theme.muted">
        {{ view === 'quota' ? '●' : '○' }} 额度概览
      </Text>
      <Text :fg="view === 'tokens' ? theme.primary : theme.muted">
        {{ view === 'tokens' ? '●' : '○' }} Token 统计
      </Text>
      <Text :fg="view === 'project' ? theme.primary : theme.muted">
        {{ view === 'project' ? '●' : '○' }} 项目用量
      </Text>
      <Text :fg="view === 'model' ? theme.primary : theme.muted">
        {{ view === 'model' ? '●' : '○' }} 模型用量
      </Text>
    </Box>

    <QuotaTab
      v-if="view === 'quota'"
      :fiveHourProgress="fiveHourProgress"
      :weekProgress="weekProgress"
      :fiveHourLabel="fiveHourLabel"
      :weekLabel="weekLabel"
      :fiveHourResetLabel="fiveHourResetLabel"
      :weekResetLabel="weekResetLabel"
    />

    <TokenStatsTab v-else-if="view === 'tokens'" :tokens="usage?.tokens ?? null" :loading="loading" />

    <UsageRankingTab
      v-else
      :title="usageTitle"
      :itemLabel="view === 'project' ? '项目' : '模型'"
      :items="visibleUsageItems"
      :totalItems="usageItems.length"
      :maxTotalTokens="usageMax"
      :loading="loading"
      :page="projectPage"
      :pageCount="projectPageCount"
      :showPagination="view === 'project'"
    />

    <Box flexDirection="row">
      <Text :fg="theme.muted" :content="hint" />
      <Text :fg="statusColor"> | {{ statusMessage }}</Text>
    </Box>
  </Box>
</template>
