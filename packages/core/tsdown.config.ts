import { defineConfig } from 'tsdown'
import { vueSfcPlugin } from 'vue-sfc-transformer/rolldown'
import { baseConfig } from '../../tsdown.base.ts'

export default defineConfig({
  ...baseConfig(import.meta.dirname, [
    vueSfcPlugin({
      srcDir: 'src',
      cwd: import.meta.dirname,
      // The build tsconfig maps `virtual:vp-search/*` onto the ambient
      // declarations; without it the declaration emit cannot resolve them.
      tsconfig: './tsconfig.json',
    }),
  ]),
  // Only the raw SFC assets import it, outside rolldown's module graph.
  unused: { ignore: ['@vueuse/core'] },
})
