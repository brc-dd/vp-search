<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { useData, useRouter } from 'vitepress'
import { computed, nextTick, onMounted, onScopeDispose, ref, shallowRef, useId, watch } from 'vue'
import type { SearchAdapter } from '../adapter.ts'
import { textOf } from '../highlight.ts'
import { interpolate } from '../translations.ts'
import type { MarkedText, ResultKind, SearchResult } from '../types.ts'
import VPMarkedText from './VPMarkedText.vue'
import { useTranslate } from './translate.ts'
import { getRelativePath } from './url.ts'
import { useSearch } from './useSearch.ts'

const { adapter, open } = defineProps<{ adapter: SearchAdapter; open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const LIMIT = 12
const QUERY_KEY = 'vp-search:query'
/** Long enough that a fast backend never flashes the spinner. */
const BUSY_DELAY = 300

const KIND_ICONS: Record<ResultKind, string[]> = {
  page: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'],
  heading: ['M4 9h16', 'M4 15h16', 'M10 3 8 21', 'M16 3l-2 18'],
  content: ['M4 6h16', 'M4 12h10', 'M4 18h13'],
}

interface Row {
  result: SearchResult
  /** Position in the flat result list — group headings are not selectable. */
  index: number
  href: string
  crumbs: MarkedText[]
  label: string
}

interface Group {
  key: string
  label: string
  rows: Row[]
}

const t = useTranslate()
const { lang, localeIndex, site } = useData()
const router = useRouter()

const dialog = shallowRef<HTMLDialogElement>()
const input = shallowRef<HTMLInputElement>()
const list = shallowRef<HTMLElement>()

const uid = useId()
const inputId = `${uid}-input`
const listId = `${uid}-list`
const optionId = (index: number) => `${uid}-option-${index}`
const groupId = (index: number) => `${uid}-group-${index}`

const { query, results, status, error, retry } = useSearch({
  adapter,
  context: () => ({ localeIndex: localeIndex.value, lang: lang.value, limit: LIMIT }),
})

/** A failed query owns the whole surface; its predecessor's hits are stale. */
const shownResults = computed(() => (status.value === 'error' ? [] : results.value))

const groups = computed(() => {
  const cleanUrls = site.value.cleanUrls
  const byKey = new Map<string, Group>()
  const out: Group[] = []
  for (const result of shownResults.value) {
    const key = result.group ?? result.url.split('#')[0]!
    let group = byKey.get(key)
    if (!group) {
      group = { key, label: result.group ?? textOf(result.titles?.[0] ?? result.title), rows: [] }
      byKey.set(key, group)
      out.push(group)
    }
    group.rows.push({
      result,
      index: 0,
      href: getRelativePath(result.url, cleanUrls),
      crumbs: result.titles ?? [],
      label: labelOf(result),
    })
  }
  // grouping reorders results, so indexes must follow DISPLAY order — keyboard navigation, aria
  // ids, and Enter all walk the flattened grouped list
  let index = 0
  for (const group of out) for (const row of group.rows) row.index = index++
  return out
})

const rows = computed(() => groups.value.flatMap((group) => group.rows))

/** What a screen reader reads for an option: the whole row, marks included. */
function labelOf(result: SearchResult): string {
  const parts = (result.titles ?? []).map(textOf)
  parts.push(textOf(result.title))
  if (result.excerpt) parts.push(textOf(result.excerpt))
  return parts.filter(Boolean).join(', ')
}

const selected = ref(0)
const mouseSelect = ref(false)

watch(results, () => {
  selected.value = 0
  scrollSelectedIntoView()
})

const state = computed(() => {
  if (!query.value.trim()) return 'idle'
  if (status.value === 'error') return 'error'
  if (rows.value.length) return 'results'
  return status.value === 'done' ? 'empty' : 'pending'
})

const busy = computed(() => status.value === 'loading')
const showBusy = ref(false)
let busyTimer: ReturnType<typeof setTimeout> | undefined

watch(busy, (value) => {
  clearTimeout(busyTimer)
  if (value) busyTimer = setTimeout(() => (showBusy.value = true), BUSY_DELAY)
  else showBusy.value = false
})

onScopeDispose(() => clearTimeout(busyTimer))

watch(error, (value) => {
  if (value) console.error('[vp-search]', value)
})

const announcement = ref('')

watch([status, results], () => {
  if (status.value !== 'done') return
  const count = results.value.length
  const key =
    count === 0
      ? 'announceNoResultsText'
      : count === 1
        ? 'announceOneResultText'
        : 'announceResultsText'
  announcement.value = interpolate(t(`modal.${key}`), { count, query: query.value.trim() })
})

/**
 * Tracked ourselves, not read off the dialog's `close` event — that fires a task late, so a re-open
 * landing in the gap would be swallowed.
 */
let shown = false
/** Whether the entry `show()` pushed is still the current one, hence ours to drop. */
let pushed = false
/** Set while the `history.back()` we issued has still to come back as `popstate`. */
let unwinding = false

async function show() {
  if (shown) return
  shown = true
  query.value = sessionStorage.getItem(QUERY_KEY) ?? ''
  selected.value = 0
  dialog.value?.showModal()
  if (!pushed) {
    pushed = true
    // our own entry, so Back closes the dialog; scroll is stashed on the entry below first, the
    // router's own convention, or unwinding would reset it
    history.replaceState({ ...history.state, scrollPosition: window.scrollY }, '')
    history.pushState(null, '', null)
  }
  // the restored query reaches the DOM on the next flush; selecting earlier would be undone by that
  // value write
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

function close() {
  if (!shown) return
  shown = false
  dialog.value?.close()
  emit('close')
  unwind()
}

/** Drops our entry, so the first Back press after a close navigates the site. */
function unwind() {
  if (!pushed) return
  pushed = false
  unwinding = true
  history.back()
}

/** Backstop for a close nobody routed through us — `dialog.close()` from elsewhere. */
function onDialogClose() {
  if (!shown) return
  shown = false
  // a task has passed since the dialog shut, so a re-open may have landed first; either way `open`
  // reflects what the app wants now, so it wins
  if (open) void show()
  else {
    emit('close')
    unwind()
  }
}

onMounted(() => {
  if (open) show()
})

watch(
  () => open,
  (value) => (value ? show() : close()),
)

watch(query, (value) => sessionStorage.setItem(QUERY_KEY, value))

useEventListener('popstate', () => {
  if (unwinding) {
    unwinding = false
    return
  }
  // whatever was popped, the entry we pushed is no longer the current one
  pushed = false
  close()
})

function onKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return
  switch (event.key) {
    case 'ArrowDown':
      return moveBy(event, 1)
    case 'ArrowUp':
      return moveBy(event, -1)
    case 'Home':
      return moveTo(event, 0)
    case 'End':
      return moveTo(event, rows.value.length - 1)
    case 'n':
    case 'p':
      if (isMacCtrlShortcut(event)) moveBy(event, event.key === 'n' ? 1 : -1)
      return
    case 'Enter':
      return onEnter(event)
  }
}

function moveBy(event: KeyboardEvent, delta: number) {
  const count = rows.value.length
  if (!count) return
  moveTo(event, (selected.value + delta + count) % count)
}

function moveTo(event: KeyboardEvent, index: number) {
  if (index < 0 || index >= rows.value.length) return
  event.preventDefault()
  selected.value = index
  mouseSelect.value = false
  scrollSelectedIntoView()
}

/** Ctrl+N/P navigate on mac only, where the theme marks `html.mac`. */
function isMacCtrlShortcut(event: KeyboardEvent) {
  return (
    event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    document.documentElement.classList.contains('mac')
  )
}

function onEnter(event: KeyboardEvent) {
  const row = rows.value[selected.value]
  if (!row || event.target instanceof HTMLButtonElement) return
  // also suppresses the anchor's own activation when a result holds focus
  event.preventDefault()
  // replaces our entry instead of pushing after unwind: history.back() lands a task later and would
  // race the push, so replacing leaves the stack reading [origin, destination] outright
  const replace = pushed
  pushed = false
  close()
  router.go(row.href, { replace })
}

function onResultClick(event: MouseEvent) {
  // The router intercepts internal link clicks in the capture phase, so the SPA navigation has
  // already started; going again would duplicate the history entry. Clicks it leaves alone (new
  // tab, downloads) keep the dialog open.
  if (!event.defaultPrevented) return
  // the destination sits on top of our entry by now, so unwinding would pop the destination
  // instead; what stays behind duplicates the URL we came from
  pushed = false
  close()
}

function onDialogClick(event: MouseEvent) {
  if (event.target === dialog.value) close()
}

function onMouseMove(event: MouseEvent) {
  if (mouseSelect.value) return
  // the first real move after keyboard navigation re-enables hover selection
  mouseSelect.value = true
  const el =
    event.target instanceof Element ? event.target.closest<HTMLElement>('[data-index]') : null
  if (el) selected.value = Number(el.dataset['index'])
}

function scrollSelectedIntoView() {
  nextTick(() => {
    const option = list.value?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!option) return
    // landing on a group's first row brings its heading along
    if (!option.previousElementSibling)
      option.closest('.group')?.scrollIntoView({ block: 'nearest' })
    option.scrollIntoView({ block: 'nearest' })
  })
}

function reset() {
  query.value = ''
  input.value?.focus()
}

function onRetry() {
  retry()
  // the button unmounts as soon as the retry succeeds, so leave focus in the input
  input.value?.focus()
}
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="VPSearchBox"
      :aria-label="t('modal.title')"
      @click="onDialogClick"
      @cancel="close"
      @close="onDialogClose"
      @keydown="onKeydown"
    >
      <div class="shell">
        <form class="search-bar" role="search" @submit.prevent @click.self="input?.focus()">
          <label class="search-label" :for="inputId">
            <span class="vpi-search search-icon" aria-hidden="true" />
            <span class="sr-only">{{ t('modal.title') }}</span>
          </label>
          <input
            :id="inputId"
            ref="input"
            v-model="query"
            class="search-input"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            :aria-controls="listId"
            :aria-expanded="rows.length ? 'true' : 'false'"
            :aria-activedescendant="rows.length ? optionId(selected) : undefined"
            :placeholder="t('modal.placeholderText')"
            autocapitalize="off"
            autocomplete="off"
            autocorrect="off"
            autofocus
            enterkeyhint="go"
            maxlength="64"
            spellcheck="false"
          />
          <div class="search-actions">
            <span v-if="showBusy" class="spinner" aria-hidden="true" />
            <button
              v-else-if="query"
              class="icon-button"
              type="button"
              :aria-label="t('modal.resetButtonTitle')"
              @click="reset"
            >
              <span class="vpi-delete" aria-hidden="true" />
            </button>
          </div>
          <button
            class="icon-button close-button"
            type="button"
            :aria-label="t('modal.backButtonTitle')"
            @click="close"
          >
            <span class="vpi-arrow-left" aria-hidden="true" />
          </button>
        </form>

        <div class="results" @mousemove="onMouseMove">
          <ul
            :id="listId"
            ref="list"
            class="result-list"
            :class="{ stale: showBusy }"
            role="listbox"
            :aria-label="t('modal.resultsLabel')"
            :aria-busy="busy ? 'true' : 'false'"
          >
            <li
              v-for="(group, groupIndex) in groups"
              :key="group.key"
              class="group"
              role="presentation"
            >
              <div :id="groupId(groupIndex)" class="group-heading" aria-hidden="true">
                {{ group.label }}
              </div>
              <ul class="group-items" role="group" :aria-labelledby="groupId(groupIndex)">
                <li
                  v-for="row in group.rows"
                  :id="optionId(row.index)"
                  :key="row.result.id ?? row.result.url"
                  class="result"
                  role="option"
                  :aria-label="row.label"
                  :aria-selected="row.index === selected ? 'true' : 'false'"
                  :data-index="row.index"
                  @mouseenter="mouseSelect && (selected = row.index)"
                >
                  <a
                    class="result-link"
                    :href="row.href"
                    @click="onResultClick"
                    @focusin="selected = row.index"
                  >
                    <svg
                      class="result-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path
                        v-for="(d, i) in KIND_ICONS[row.result.kind ?? 'page']"
                        :key="i"
                        :d="d"
                      />
                    </svg>
                    <span class="result-text">
                      <span v-if="row.crumbs.length" class="result-crumbs">
                        <template v-for="(crumb, i) in row.crumbs" :key="i">
                          <VPMarkedText :text="crumb" />
                          <span
                            v-if="i < row.crumbs.length - 1"
                            class="vpi-chevron-right crumb-icon"
                            aria-hidden="true"
                          />
                        </template>
                      </span>
                      <span class="result-title"><VPMarkedText :text="row.result.title" /></span>
                      <span v-if="row.result.excerpt" class="result-excerpt">
                        <VPMarkedText :text="row.result.excerpt" />
                      </span>
                    </span>
                  </a>
                </li>
              </ul>
            </li>
          </ul>

          <p v-if="state === 'idle'" class="state">{{ t('modal.idleText') }}</p>
          <p v-else-if="state === 'empty'" class="state">
            {{ t('modal.noResultsText') }} <strong>{{ query.trim() }}</strong>
          </p>
          <div v-else-if="state === 'error'" class="state state-error" role="alert">
            <p>{{ t('modal.errorText') }}</p>
            <button class="retry-button" type="button" @click="onRetry">
              {{ t('modal.retryText') }}
            </button>
          </div>
        </div>

        <div class="footer">
          <p class="shortcuts">
            <span class="shortcut">
              <kbd :aria-label="t('modal.footer.navigateUpKeyAriaLabel')">
                <span class="vpi-arrow-up shortcut-icon" aria-hidden="true" />
              </kbd>
              <kbd :aria-label="t('modal.footer.navigateDownKeyAriaLabel')">
                <span class="vpi-arrow-down shortcut-icon" aria-hidden="true" />
              </kbd>
              {{ t('modal.footer.navigateText') }}
            </span>
            <span class="shortcut">
              <kbd :aria-label="t('modal.footer.selectKeyAriaLabel')">
                <span class="vpi-corner-down-left shortcut-icon" aria-hidden="true" />
              </kbd>
              {{ t('modal.footer.selectText') }}
            </span>
            <span class="shortcut">
              <kbd :aria-label="t('modal.footer.closeKeyAriaLabel')">esc</kbd>
              {{ t('modal.footer.closeText') }}
            </span>
          </p>
          <a
            v-if="adapter.attribution?.url"
            class="attribution"
            :href="adapter.attribution.url"
            target="_blank"
            rel="noreferrer"
          >
            {{ t('modal.searchByText') }}{{ adapter.attribution.label }}
          </a>
          <span v-else-if="adapter.attribution" class="attribution">
            {{ t('modal.searchByText') }}{{ adapter.attribution.label }}
          </span>
        </div>

        <span class="sr-only" role="status" aria-live="polite">{{ announcement }}</span>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.VPSearchBox {
  display: none;
  position: fixed;
  inset: 0;
  inline-size: 100%;
  block-size: 100dvh;
  max-inline-size: none;
  max-block-size: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: var(--vp-c-text-1);
  overflow: hidden;
  /* layout lives outside [open] so the closing transition keeps it */
  align-items: flex-start;
  justify-content: center;
  padding-block: 4rem;

  &[open] {
    display: flex;
  }

  &::backdrop {
    background: var(--vp-backdrop-bg-color);
  }

  @media (prefers-reduced-motion: no-preference) {
    opacity: 0;
    translate: 0 -0.5rem;
    transition:
      opacity 0.15s ease,
      translate 0.15s ease,
      display 0.15s allow-discrete,
      overlay 0.15s allow-discrete;

    &[open] {
      opacity: 1;
      translate: none;

      @starting-style {
        opacity: 0;
        translate: 0 -0.5rem;
      }
    }

    &::backdrop {
      opacity: 0;
      transition:
        opacity 0.15s ease,
        display 0.15s allow-discrete,
        overlay 0.15s allow-discrete;
    }

    &[open]::backdrop {
      opacity: 1;

      @starting-style {
        opacity: 0;
      }
    }
  }
}

.shell {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  inline-size: min(100% - 3.75rem, 56.25rem);
  max-block-size: 100%;
  padding: 0.75rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.75rem;
  background: var(--vp-local-search-bg);
  box-shadow: var(--vp-shadow-3);
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding-inline: 0.75rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.5rem;
  cursor: text;

  &:focus-within {
    border-color: var(--vp-c-brand-1);
  }
}

.search-label {
  display: flex;
  align-items: center;
  color: var(--vp-c-text-2);
}

.search-icon {
  font-size: 1.125rem;
}

.search-input {
  flex: 1;
  min-inline-size: 0;
  padding-block: 0.625rem;
  font-size: 1rem;
  background: transparent;

  &::placeholder {
    color: var(--vp-c-text-3);
  }
}

.search-actions {
  display: grid;
  place-items: center;
  flex: none;
  inline-size: 1.75rem;
  block-size: 1.75rem;
}

.icon-button {
  display: grid;
  place-items: center;
  flex: none;
  inline-size: 1.75rem;
  block-size: 1.75rem;
  border-radius: 0.375rem;
  color: var(--vp-c-text-2);
  font-size: 1rem;

  &:hover {
    color: var(--vp-c-brand-1);
    background: color-mix(in srgb, var(--vp-c-brand-1) 10%, transparent);
  }

  &:focus-visible {
    outline: 2px solid var(--vp-c-brand-1);
    outline-offset: 1px;
  }
}

.close-button {
  @media (width >= 48rem) {
    display: none;
  }
}

.spinner {
  inline-size: 1.125rem;
  block-size: 1.125rem;
  border: 2px solid var(--vp-c-divider);
  border-block-start-color: var(--vp-c-brand-1);
  border-radius: 50%;

  @media (prefers-reduced-motion: no-preference) {
    animation: spin 0.8s linear infinite;
  }
}

@keyframes spin {
  to {
    rotate: 360deg;
  }
}

.results {
  /* grows only where the shell has spare height — full screen on small viewports */
  flex: 1 1 auto;
  min-block-size: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

.result-list,
.group-items {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

.result-list {
  gap: 0.75rem;

  @media (prefers-reduced-motion: no-preference) {
    transition: opacity 0.15s ease;
  }

  &.stale {
    opacity: 0.55;
  }
}

.group-items {
  gap: 0.25rem;
}

.group-heading {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}

.result-link {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--vp-local-search-result-border);
  border-radius: 0.5rem;
  background: var(--vp-local-search-result-bg);
  color: var(--vp-c-text-1);
  line-height: 1.4;

  &:focus-visible {
    outline: 2px solid var(--vp-c-brand-1);
    outline-offset: 2px;
  }
}

.result[aria-selected='true'] .result-link {
  border-color: var(--vp-local-search-result-selected-border);
  background: color-mix(in srgb, var(--vp-c-brand-1) 8%, var(--vp-local-search-result-selected-bg));

  /* focusin syncs selection, so the selected border already marks focus */
  &:focus-visible {
    outline: none;
  }
}

.result[aria-selected='true'] .result-title {
  color: var(--vp-c-brand-1);
}

.result-icon {
  flex: none;
  inline-size: 1rem;
  block-size: 1rem;
  margin-block-start: 0.125rem;
  color: var(--vp-c-text-3);
}

.result-text {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-inline-size: 0;
}

.result-crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--vp-c-text-2);
}

.crumb-icon {
  font-size: 0.75rem;
  opacity: 0.6;

  &:dir(rtl) {
    rotate: 180deg;
  }
}

.result-title {
  font-weight: 500;
}

.result-excerpt {
  max-block-size: 2lh;
  overflow: hidden;
  font-size: 0.8125rem;
  color: var(--vp-c-text-2);
  text-wrap: pretty;
}

.result-text :deep(mark) {
  padding-inline: 0.125rem;
  border-radius: 0.125rem;
  background: var(--vp-local-search-highlight-bg);
  color: var(--vp-local-search-highlight-text);
}

.state {
  margin: 0;
  padding-block: 2.5rem;
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  text-align: center;
  text-wrap: pretty;
}

.state-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;

  p {
    margin: 0;
  }
}

.retry-button {
  padding: 0.375rem 0.75rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.5rem;
  font-size: 0.8125rem;

  &:hover {
    border-color: var(--vp-c-brand-1);
    color: var(--vp-c-brand-1);
  }

  &:focus-visible {
    outline: 2px solid var(--vp-c-brand-1);
    outline-offset: 1px;
  }
}

.footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: var(--vp-c-text-2);
}

.shortcuts {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin: 0;

  @media (width < 48rem) {
    display: none;
  }
}

.shortcut {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.shortcut-icon {
  display: block;
  font-size: 0.875rem;
}

kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-inline-size: 1.5rem;
  block-size: 1.375rem;
  padding-inline: 0.375rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.25rem;
  background: var(--vp-c-bg-alt);
  font-family: inherit;
  font-size: 0.75rem;
  line-height: 1;
  vertical-align: middle;
}

.attribution {
  margin-inline-start: auto;

  &:hover {
    color: var(--vp-c-brand-1);
  }

  &:focus-visible {
    outline: 2px solid var(--vp-c-brand-1);
    outline-offset: 2px;
  }
}

.sr-only {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (width < 48rem) {
  .VPSearchBox {
    padding: 0;
  }

  .shell {
    inline-size: 100%;
    block-size: 100%;
    max-block-size: none;
    border: 0;
    border-radius: 0;
  }
}
</style>

<style>
/* The dialog's top layer keeps the page visible (and scrollable) behind it, so overflow is still
   explicitly locked here; the gutter reservation keeps that from shifting the layout. */
html:has(dialog.VPSearchBox[open]) {
  overflow: hidden;
  scrollbar-gutter: stable;
}
</style>
