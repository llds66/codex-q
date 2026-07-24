<script setup lang="ts">
import { Box, Text } from 'vue-termui'
import type { TokenUsageSummary } from '../services/codexUsageReader'
import { theme } from '../theme.js'

defineProps<{
  tokens: TokenUsageSummary | null
  loading: boolean
}>()

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}
</script>

<template>
  <Box border :width="58" borderStyle="rounded" :borderColor="theme.primary" :padding="1" flexDirection="column" :gap="1">
    <template v-if="tokens">
      <Box flexDirection="row" :gap="1">
        <Text :fg="theme.selectedText">输入 Token（含缓存）：</Text>
        <Text :fg="theme.selectedText">{{ formatNumber(tokens.inputTokens) }}</Text>
      </Box>
      <Text :fg="theme.accent">输出 Token：{{ formatNumber(tokens.outputTokens) }}</Text>
      <Text :fg="theme.primary" bold>累计 Token：{{ formatNumber(tokens.totalTokens) }}</Text>
    </template>
    <Text v-else :fg="theme.muted">
      {{ loading ? '正在读取 Token 统计…' : '本地日志中暂无 Token 统计数据' }}
    </Text>
  </Box>
</template>
