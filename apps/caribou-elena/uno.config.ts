import { defineConfig, presetUno, presetIcons } from 'unocss'
import transformerDirectives from '@unocss/transformer-directives'
import { presetCaribou } from '@beatzball/caribou-design-tokens/uno-preset'

export default defineConfig({
  presets: [
    presetCaribou(),
    presetUno(),
    presetIcons({ scale: 1, extraProperties: { display: 'inline-block' } }),
  ],
  transformers: [transformerDirectives()],
  content: {
    filesystem: [
      'pages/**/*.{ts,html}',
      'app.ts',
      '../../packages/*/src/**/*.ts',
    ],
  },
})
