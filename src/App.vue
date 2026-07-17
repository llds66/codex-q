<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Box, Text, bold, t, ProgressBar, onKeyDown, useExit } from 'vue-termui'
import { readCodexUsage, type CodexUsageSnapshot } from './services/codexUsageReader'

const exit = useExit()
const usage = ref<CodexUsageSnapshot | null>(null)
const loading = ref(true)
const errorMessage = ref('')
const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | undefined

const fiveHourProgress = computed(() => usage.value?.fiveHour?.remainingPercent ?? 100)
const weekProgress = computed(() => usage.value?.week?.remainingPercent ?? 0)

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

const weekResetLabel = computed(() => {
  const resetsAt = usage.value?.week?.resetsAt
  if (!resetsAt) return '重置时间：--'

  const remainingSeconds = Math.max(0, Math.floor((resetsAt.getTime() - now.value) / 1000))
  if (remainingSeconds <= 0) return '重置时间：等待额度数据同步'

  const days = Math.floor(remainingSeconds / 86_400)
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600)
  const minutes = Math.floor((remainingSeconds % 3_600) / 60)
  const seconds = remainingSeconds % 60

  if (days > 0) return `重置时间：${days}天${hours}时后`
  if (hours > 0) return `重置时间：${hours}时${minutes}分后`
  return `重置时间：${minutes}分${seconds}秒后`
})

const statusMessage = computed(() => {
  if (loading.value) return '正在同步 Codex 额度...'
  return errorMessage.value || usage.value?.statusMessage || '暂无额度数据'
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
  else if (key.name === 'r') {
    void refreshUsage()
  }
})

const hint = t` ${bold('r')} 刷新数据 · ${bold('q')} 退出`
</script>

<template>
  <Text fg="#42b883" bold>> Codex</Text>
  <Box border :width="50" borderStyle="rounded" borderColor="42b883" :padding="1" flexDirection="column" :gap="1">
    <Box flexDirection="row" :gap="1">
      <ProgressBar :value="fiveHourProgress" :max="100" :width="20" color="#42b883" />
      <Text fg="#42b883">{{ fiveHourLabel }}</Text>
    </Box>
    <Box flexDirection="row" :gap="1">
      <ProgressBar :value="weekProgress" :max="100" :width="20" color="#42b883" />
      <Text fg="#42b883">{{ weekLabel }}</Text>
    </Box>
    <Text dim>{{ weekResetLabel }}</Text>
  </Box>

  <Box flexDirection="row">
    <Text dim :content="hint" />
    <Text dim> | {{ statusMessage }}</Text>
  </Box>
</template>
