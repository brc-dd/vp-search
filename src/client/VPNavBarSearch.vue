<script setup lang="ts">
import { onKeyStroke } from '@vueuse/core'
import adapter from 'virtual:any-search/adapter'
// not re-exported by `vitepress/theme`, so the button is reused by path rather
// than by copying its styles
import VPNavBarSearchButton from 'vitepress/dist/client/theme-default/components/VPNavBarSearchButton.vue'
import { defineAsyncComponent, onMounted, ref } from 'vue'
import { useTranslate } from './translate.ts'

const VPSearchBox = defineAsyncComponent(() => import('./VPSearchBox.vue'))

const t = useTranslate()
const loaded = ref(false)
const open = ref(false)

function openSearch() {
  loaded.value = true
  open.value = true
}

onKeyStroke('k', (event) => {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault()
    openSearch()
  }
})

onKeyStroke('/', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || isEditingContent(event)) return
  event.preventDefault()
  openSearch()
})

function isEditingContent(event: KeyboardEvent) {
  const el = event.target
  return (
    el instanceof HTMLElement && (el.isContentEditable || el.matches('input, select, textarea'))
  )
}

onMounted(() => {
  const origins = adapter.preconnect
  if (!origins?.length) return
  onIdle(() => {
    for (const origin of origins) {
      const id = `any-search-preconnect-${origin}`
      if (document.getElementById(id)) continue
      const link = document.createElement('link')
      link.id = id
      link.rel = 'preconnect'
      link.href = origin
      link.crossOrigin = ''
      document.head.append(link)
    }
  })
})

/** Safari still ships no `requestIdleCallback`. */
function onIdle(callback: () => void) {
  if ('requestIdleCallback' in window) window.requestIdleCallback(callback)
  else setTimeout(callback, 1)
}
</script>

<template>
  <div class="VPNavBarSearch">
    <VPNavBarSearchButton
      :text="t('button.buttonText')"
      :aria-label="t('button.buttonAriaLabel')"
      aria-keyshortcuts="/ control+k meta+k"
      aria-haspopup="dialog"
      @click="openSearch"
    />
    <VPSearchBox v-if="loaded" :adapter :open @close="open = false" />
  </div>
</template>

<style scoped>
.VPNavBarSearch {
  display: flex;
  align-items: center;

  @media (width >= 48rem) {
    flex-grow: 1;
    gap: 0.5rem;
    padding-inline-start: 1.5rem;
  }

  @media (width >= 60rem) {
    padding-inline-start: 2rem;
  }
}
</style>
