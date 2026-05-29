import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dist = join(__dirname, '..', 'dist')

const files = readdirSync(dist)
const htmlFile = files.find(f => f.endsWith('.html'))
const jsFile = files.find(f => f.endsWith('.js'))
const cssFile = files.find(f => f.endsWith('.css'))

let html = readFileSync(join(dist, htmlFile), 'utf-8')

if (cssFile) {
  const css = readFileSync(join(dist, cssFile), 'utf-8')
  html = html.replace(
    /<link rel=stylesheet href=\/[^>]+>/,
    () => `<style>${css}</style>`
  )
}

if (jsFile) {
  const js = readFileSync(join(dist, jsFile), 'utf-8')
  html = html.replace(
    /<script type=module src=\/[^>]+><\/script>/,
    () => `<script>${js}</script>`
  )
}

writeFileSync(join(dist, 'miyapad.html'), html)
