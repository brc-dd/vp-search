import { fromRanges, fromTagged } from '../src/highlight.ts'

const P = ''
const Q = ''
const out = {
  adjacentRanges: fromRanges('快速开始 now', [
    { start: 0, end: 2 },
    { start: 2, end: 4 },
  ]),
  gappedRanges: fromRanges('a bc d', [
    { start: 0, end: 1 },
    { start: 2, end: 4 },
  ]),
  adjacentTags: fromTagged(`${P}快速${Q}${P}开始${Q} now`, P, Q),
  gappedTags: fromTagged(`pre ${P}one${Q} mid ${P}two${Q}`, P, Q),
}
console.log(JSON.stringify(out, null, 1))
