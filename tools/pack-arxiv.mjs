#!/usr/bin/env node
/**
 * pack-arxiv.mjs —— 把出稿链的产物打成 **arXiv 源码包**（正式文本），并在打包目录里**真编一遍**当判据。
 *
 * 为什么单开一个装置（三条都是会在提交那一刻才咬人的）：
 *   ① `report/draft-en.tex` 里的图路径是 `../figures/figN.png`（pandoc 从仓库根生成到 `report/`），
 *      而 arXiv 的编译器在**一个扁平目录**里跑 ⇒ `../figures/...` 解不开 ⇒ **源码编译失败**。
 *   ② 内部文件名带 `draft` 字样。**内部沿用 `draft.md`（改它会牵动几十处引用），提交件不带**：
 *      主文件在这里改名为 `two-walls-two-rulers.tex`（PDF 同名）。
 *   ③ 编译中间件（`.log`）里带本机绝对路径 ⇒ 打包后要清场，否则红线自检会被自己的产物咬。
 *
 * 用法：node tools/pack-arxiv.mjs [--out dist/arxiv]
 * 判据（任何一条不过 ⇒ exit 3，不产出「看着打包好了」的假成功）：
 *   ① 扁平化只许改含 `\includegraphics` 的行，别的字一个不动
 *   ② 四张图都在打包目录里、且 PNG 头合法
 *   ③ 在扁平目录里 pdflatex ×2 **编译成功**、PDF 生成、页数与出稿版一致（±0）、`Missing character` 0
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAIN = 'two-walls-two-rulers'          // 提交件的主文件名（不带 draft）
const args = process.argv.slice(2)
const oi = args.indexOf('--out')
const OUT = join(ROOT, oi >= 0 && args[oi + 1] ? args[oi + 1] : 'dist/arxiv')
const fail = (m) => { console.error(`❌ ${m}`); process.exit(3) }

const bin = process.env.MIKETEX_BIN || process.env.PDFLATEX_DIR || ''
const pdflatex = process.env.PDFLATEX || (bin ? join(bin, 'pdflatex.exe') : '')
if (!pdflatex) fail('没给 pdflatex：设 MIKETEX_BIN=<.../miktex/bin/x64>')
if (!existsSync(pdflatex)) fail(`pdflatex 不在：${pdflatex}`)

const src = join(ROOT, 'report', 'draft-en.tex')
if (!existsSync(src)) fail('report/draft-en.tex 不在 —— 先跑 tools/build-report.mjs')
const tex = readFileSync(src, 'utf8')

// ---- ⓪ 提交件里不许出现「草稿」标记 ----
const DRAFT_WORDS = [/working draft/i, /not submitted/i, /\bDraft v\d/i, /草稿/]
const bad = DRAFT_WORDS.filter((re) => re.test(tex)).map((re) => re.source)
if (bad.length) fail(`提交件里还有草稿标记：${bad.join(' · ')} —— 先改 report/draft.md 首部，再重建`)

// ---- ① 扁平化：只动图路径 ----
const flat = tex.replace(/\.\.\/figures\//g, '')
const a = tex.split('\n'), b = flat.split('\n')
if (a.length !== b.length) fail('扁平化改变了行数（不该发生）')
let touched = 0
for (let i = 0; i < a.length; i++) {
  if (a[i] !== b[i]) { touched++; if (!a[i].includes('\\includegraphics')) fail(`第 ${i + 1} 行被改动但不含 \\includegraphics：${a[i].slice(0, 80)}`) }
}
if (touched === 0) fail('一条 includegraphics 都没改到 —— 图路径可能已经变了，先看一眼 draft-en.tex')
console.log(`  ① 扁平化：改了 ${touched} 行，全在 \\includegraphics 上`)

// ---- ② 图 ----
const figs = [...flat.matchAll(/\\includegraphics[^{]*\{([^}]+)\}/g)].map((m) => m[1])
if (figs.length === 0) fail('没解析到任何图')
mkdirSync(OUT, { recursive: true })
for (const f of new Set(figs)) {
  const p = join(ROOT, 'figures', basename(f))
  if (!existsSync(p)) fail(`图不在：${p}`)
  const buf = readFileSync(p)
  if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) fail(`不是合法 PNG：${p}`)
  copyFileSync(p, join(OUT, basename(f)))
}
console.log(`  ② 图：${new Set(figs).size} 张已拷入并验头`)

writeFileSync(join(OUT, `${MAIN}.tex`), flat, 'utf8')
console.log(`  ②b 主文件：${MAIN}.tex（提交件不带 draft 字样）`)

// ---- ③ 在扁平目录里真编一遍 ----
const log = []
for (let pass = 1; pass <= 2; pass++) {
  try {
    log.push(execFileSync(pdflatex, ['-interaction=nonstopmode', '-halt-on-error', `${MAIN}.tex`],
      { cwd: OUT, encoding: 'latin1', stdio: ['ignore', 'pipe', 'pipe'] }).toString())
  } catch (e) {
    const tail = (e.stdout?.toString() ?? '').split('\n').filter((l) => l.startsWith('!') || /Error/.test(l)).slice(0, 6).join('\n')
    fail(`扁平目录里第 ${pass} 遍编译失败：\n${tail || e.message}`)
  }
}
const all = log.join('\n')
const missing = (all.match(/Missing character/g) ?? []).length
const pdf = join(OUT, `${MAIN}.pdf`)
if (!existsSync(pdf)) fail('编译没吐出 PDF')
const s = readFileSync(pdf)
const counts = [...s.toString('latin1').matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]))
const pages = Math.max(...counts)
const ref = readFileSync(join(ROOT, 'report', 'draft-en.pdf')).toString('latin1')
const refPages = Math.max(...[...ref.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1])))
if (missing !== 0) fail(`编译日志里 Missing character ${missing} 处（出稿链的判据是 0）`)
if (pages !== refPages) fail(`页数不一致：扁平编 ${pages} 页 vs 出稿版 ${refPages} 页`)
console.log(`  ③ 扁平目录编译：✅ ${pages} 页（与出稿版一致）· Missing character ${missing}`)

// ---- ④ 清场 + 复核 ----
// 删掉编译中间件：① 让上传包干净 ② `.log` 里带本机绝对路径（红线自检会咬它）
for (const f of readdirSync(OUT)) if (/\.(aux|log|out)$/.test(f)) unlinkSync(join(OUT, f))
if (readdirSync(OUT).some((f) => /\.(aux|log|out)$/.test(f))) fail('清场没干净')
if (!existsSync(join(OUT, `${MAIN}.tex`)) || !existsSync(join(OUT, `${MAIN}.pdf`))) fail('主文件或 PDF 不在包里')

const files = readdirSync(OUT).sort()
const size = files.reduce((n, f) => n + statSync(join(OUT, f)).size, 0)
console.log(`✅ arXiv 源码包（正式文本）：${OUT}`)
console.log(`   ${files.join(' · ')}`)
console.log(`   合计 ${(size / 1024).toFixed(1)} KB —— 上限 50 MB，余量充裕`)
console.log(`   上传法：把本目录里的文件**全部**（扁平，不带子目录）传上去，主文件 = ${MAIN}.tex`)
console.log(`   给外人发的 PDF = ${MAIN}.pdf（同一份内容，名字里没有 draft）`)
