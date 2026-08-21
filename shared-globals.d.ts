/**
 * Cross-runtime globals (browser, worker, Node) that environment-neutral code may use but the bare
 * ES lib of the `tsconfig.shared.json` projects lacks. Declared merge-compatibly with lib.dom and
 * @types/node — interface merging plus an identically typed `var` — so the file stays valid in
 * whichever program the editor assigns it to. Keep members to what shared code touches.
 */

interface AbortSignal {
  readonly aborted: boolean
}

interface Performance {
  now(): number
}

declare var performance: Performance
