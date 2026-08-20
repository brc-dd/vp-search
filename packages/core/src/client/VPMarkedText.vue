<script setup lang="ts">
import type { MarkedText } from '../types.ts'

defineProps<{ text: MarkedText }>()
</script>

<template>
  <template v-for="(seg, i) in text" :key="i">
    <mark v-if="seg.mark">{{ seg.text }}</mark>
    <template v-else>{{ seg.text }}</template>
  </template>
</template>
