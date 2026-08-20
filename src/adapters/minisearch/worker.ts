import { loadTier, runSearch, type TierState } from './core.ts'
import type {
  Artifact,
  InitRequest,
  SearchRequest,
  WorkerRequest,
  WorkerResponse,
} from './types.ts'

/** The DOM lib types `self` as a Window; this module only runs as a worker. */
const scope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void
  postMessage(message: WorkerResponse): void
  close(): void
}

let state: TierState = {}
/** Bumped by re-init (locale switch) so superseded tier loads can't land. */
let generation = 0

scope.addEventListener('message', (event) => {
  const request = event.data
  if (request.type === 'init') void init(request)
  else if (request.type === 'search') search(request)
  else scope.close()
})

async function init(request: InitRequest): Promise<void> {
  const current = ++generation
  state = {}
  try {
    const titles = loadTier(await fetchArtifact(request.base + request.entry.titles))
    if (current !== generation) return
    state = { titles }
    scope.postMessage({ type: 'tier', tier: 'titles' })
    const content = loadTier(await fetchArtifact(request.base + request.entry.content))
    if (current !== generation) return
    state = { titles, content }
    scope.postMessage({ type: 'tier', tier: 'content' })
  } catch (error) {
    if (current === generation) scope.postMessage({ type: 'error', message: reason(error) })
  }
}

function search(request: SearchRequest): void {
  try {
    scope.postMessage({
      type: 'results',
      id: request.id,
      response: runSearch(state, request.query, request.limit),
    })
  } catch (error) {
    scope.postMessage({ type: 'error', id: request.id, message: reason(error) })
  }
}

async function fetchArtifact(url: string): Promise<Artifact> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`)
  return response.json() as Promise<Artifact>
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
