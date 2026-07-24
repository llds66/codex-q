<script setup lang="ts">
import { Box, ProgressBar, Text } from 'vue-termui'
import { theme } from '../theme.js'

defineProps<{
  fiveHourProgress: number
  weekProgress: number
  fiveHourLabel: string
  weekLabel: string
  fiveHourResetLabel: string
  weekResetLabel: string
}>()
</script>

<template>
  <Box border :width="50" borderStyle="rounded" :borderColor="theme.primary" :padding="1" flexDirection="column" :gap="1">
    <Box flexDirection="row" :gap="1">
      <ProgressBar :value="fiveHourProgress" :max="100" :width="20" :color="theme.primary" :trackColor="theme.muted" />
      <Text :fg="theme.primary">{{ fiveHourLabel }}</Text>
    </Box>
    <Box flexDirection="row" :gap="1">
      <ProgressBar :value="weekProgress" :max="100" :width="20" :color="theme.primary" :trackColor="theme.muted" />
      <Text :fg="theme.primary">{{ weekLabel }}</Text>
    </Box>
    <Text :fg="theme.muted">{{ fiveHourResetLabel }}</Text>
    <Text :fg="theme.muted">{{ weekResetLabel }}</Text>
  </Box>
</template>
