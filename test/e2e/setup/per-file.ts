import { afterAll, beforeAll } from 'vitest'
import { connect, disconnect } from './browser.ts'

beforeAll(connect)
afterAll(disconnect)
