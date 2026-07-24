<script setup lang="ts">
import { Box, ProgressBar, Text } from "vue-termui"
import type { UsageBreakdownItem } from "../services/codexUsageReader"
import { theme } from "../theme.js"

const props = defineProps<{
  title: string
  itemLabel: string
  items: UsageBreakdownItem[]
  totalItems: number
  maxTotalTokens: number
  loading: boolean
  page: number
  pageCount: number
  showPagination: boolean
}>()

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value)
}

function formatUsageName(name: string) {
  return name.length > 18 ? `${name.slice(0, 17)}…` : name
}
</script>

<template>
  <Box
    border
    :width="72"
    borderStyle="rounded"
    :borderColor="theme.primary"
    :padding="1"
    flexDirection="column"
    :gap="1"
  >
    <Text v-if="!items.length && !totalItems" :fg="theme.muted">
      {{ loading ? "正在读取用量统计…" : "本地日志中暂无可归类的用量数据" }}
    </Text>
    <template v-else>
      <Box flexDirection="row" :gap="2">
        <Text :fg="theme.primary" bold>{{ title }}</Text>
        <Text :fg="theme.muted">
          {{
            showPagination
              ? `共 ${totalItems} 个${itemLabel} · 第 ${page + 1}/${pageCount} 页`
              : `共 ${totalItems} 个${itemLabel}`
          }}
        </Text>
      </Box>
      <Box v-for="item in items" :key="item.name" flexDirection="row" :gap="2">
        <Box :width="30" flexDirection="column" :gap="0">
          <Box flexDirection="row" :gap="1">
            <Text :fg="theme.accent">{{ formatUsageName(item.name) }}</Text>
            <Text :fg="theme.muted">({{ item.sessionCount }}会话)</Text>
          </Box>
          <ProgressBar
            :value="item.totalTokens"
            :max="maxTotalTokens"
            :width="28"
            :color="theme.primary"
            :trackColor="theme.surface"
          />
        </Box>
        <Box flexDirection="column" :gap="0">
          <Box flexDirection="row" :gap="1">
            <Text :fg="theme.muted">累计</Text>
            <Text :fg="theme.primary" bold>{{ formatNumber(item.totalTokens) }} Token</Text>
          </Box>
          <Box flexDirection="row" :gap="2">
            <Box :width="22" flexDirection="row" :gap="1">
              <Text :fg="theme.muted">输入</Text>
              <Text :fg="theme.selectedText">{{ formatNumber(item.inputTokens) }}</Text>
            </Box>
            <Box flexDirection="row" :gap="1">
              <Text :fg="theme.muted">输出</Text>
              <Text :fg="theme.accent">{{ formatNumber(item.outputTokens) }}</Text>
            </Box>
          </Box>
        </Box>
      </Box>
    </template>
  </Box>
</template>
