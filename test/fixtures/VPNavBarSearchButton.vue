<script setup lang="ts">
defineProps<{ text?: string }>()
</script>

<template>
  <button type="button" class="VPNavBarSearchButton">{{ text }}</button>
</template>
