// Regenerate opaque white/mixed GIF-focus clips using the installed browsers:
// pnpm exec node tests/e2e/fixtures/focus-media/make.mjs (from apps/caribou).
// Canvas capture uses no camera, live media or account data.
import { writeFile } from 'node:fs/promises'
import { chromium, webkit } from '@playwright/test'

for (const [engine, mime, extension] of [[chromium, 'video/webm', 'webm'], [webkit, 'video/mp4', 'mp4']]) {
  const browser = await engine.launch()
  try {
    const page = await browser.newPage()
    await page.setContent('<canvas width="32" height="16"></canvas>')
    for (const pattern of ['white', 'mixed']) {
      const bytes = await page.evaluate(async ({ mime, pattern }) => {
        const canvas = document.querySelector('canvas')
        const context = canvas.getContext('2d')
        const paint = () => {
          context.fillStyle = 'white'
          context.fillRect(0, 0, 32, 16)
          if (pattern === 'mixed') {
            context.fillStyle = 'black'
            context.fillRect(16, 0, 16, 16)
          }
        }
        paint()
        const stream = canvas.captureStream(5)
        const recorder = new MediaRecorder(stream, { mimeType: mime })
        const chunks = []
        recorder.ondataavailable = (event) => chunks.push(event.data)
        const stopped = new Promise((resolve) => { recorder.onstop = resolve })
        recorder.start()
        const timer = setInterval(paint, 100)
        await new Promise((resolve) => setTimeout(resolve, 1000))
        recorder.stop()
        await stopped
        clearInterval(timer)
        stream.getTracks().forEach((track) => track.stop())
        return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()))
      }, { mime, pattern })
      await writeFile(new URL(`./${pattern}.${extension}`, import.meta.url), Buffer.from(bytes))
    }
  } finally {
    await browser.close()
  }
}
