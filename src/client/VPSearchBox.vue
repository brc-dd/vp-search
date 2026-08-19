<script setup lang="ts">
import type { SearchAdapter } from '../adapter.ts'
import VPMarkedText from './VPMarkedText.vue'
import { useSearch } from './useSearch.ts'

// Placeholder UI: proves the data contract renders end to end. The real
// component (combobox semantics, focus management, keyboard navigation,
// live regions) is a separate phase; see DESIGN.md.
const { adapter } = defineProps<{ adapter: SearchAdapter }>()

const { query, results, total, status, error } = useSearch({ adapter })
</script>

<template>
  <div class="VPSearchBox">
    <input v-model="query" type="search" placeholder="Search" />
    <p v-if="status === 'error'">Search failed: {{ error }}</p>
    <p v-else-if="status === 'done' && total">
      {{ total.exact ? '' : '~' }}{{ total.count }} results
    </p>
    <ul>
      <li v-for="result in results" :key="result.id ?? result.url">
        <a :href="result.url">
          <template v-for="(crumb, i) in result.titles" :key="i">
            <VPMarkedText :text="crumb" /> ›
          </template>
          <strong><VPMarkedText :text="result.title" /></strong>
        </a>
        <p v-if="result.excerpt"><VPMarkedText :text="result.excerpt" /></p>
      </li>
    </ul>
    <slot name="powered-by" :attribution="adapter.attribution">
      <a v-if="adapter.attribution" :href="adapter.attribution.url" target="_blank" rel="noopener">
        Search by {{ adapter.attribution.label }}
      </a>
    </slot>
  </div>
</template>
