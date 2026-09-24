#!/usr/bin/env node
// 生成 arXiv 交稿用的英文版正文与它的图：report/draft-en.md + figures/*.png
//   ① 去掉开头那段「中文摘要（与人读版）」blockquote —— pdfTeX 排不了汉字
//   ② `D先生` → `D`（ASCII，名字留着）
//   ③ 四张 SVG 用 Edge 截成 PNG（LaTeX 不认 SVG），正文里的 figures/x.svg 一律改指 .png
// 判据（都打印出来）：剩余汉字必须 0（否则 exit 3）；四张 PNG 必须真生成（否则 exit 3）
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PROF = join(process.env.TEMP || '.', 'edge-pdf-profile')

// ---- 1) 正文 ----
const src = readFileSync(join(ROOT, 'report', 'draft.md'), 'utf8')
let dropped = 0, inBlock = false
const kept = []
for (const ln of src.split('\n')) {
  if (!inBlock && /^>\s*\*\*中文摘要/.test(ln)) { inBlock = true; dropped++; continue }
  if (inBlock) { if (ln.startsWith('>')) { dropped++; continue } inBlock = false }
  kept.push(ln)
}
let out = kept.join('\n')
const nameFixes = (out.match(/D先生/g) || []).length
out = out.replace(/D先生/g, 'D').replace(/D 先生/g, 'D')

// ---- 2) 图：SVG → PNG ----
const figs = ['fig1-failures', 'fig2-two-rulers', 'fig3-judging-decomposition', 'fig4-behavioral']
const report = []
for (const f of figs) {
  const svgPath = join(ROOT, 'figures', f + '.svg')
  const pngPath = join(ROOT, 'figures', f + '.png')
  const tag = /<svg[^>]*>/.exec(readFileSync(svgPath, 'utf8'))[0]
  const w = Number((/width="(\d+)"/.exec(tag) || [])[1])
  const h = Number((/height="(\d+)"/.exec(tag) || [])[1])
  execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${PROF}`,
    '--hide-scrollbars', '--default-background-color=FFFFFFFF', `--window-size=${w},${h}`,
    `--screenshot=${pngPath}`, 'file:///' + svgPath.replace(/\\/g, '/')], { stdio: 'ignore' })
  if (!existsSync(pngPath)) { console.error('❌ PNG 没生成：' + f); process.exit(3) }
  report.push(`${f}.png ${statSync(pngPath).size} B (svg ${w}×${h})`)
}

// ---- 2.5) 排不出来的符号 → 数学模式（2026-09-20 加）----
// 为什么必须在这一步做：**pdflatex 排不了这十个字符，而且是静默丢字** ——
// 它只在 log 里记一行 `! LaTeX Error: Unicode character κ (U+03BA)`，exit 0、PDF 照样出，
// 于是 κ（论文里的 Cohen's κ）和 `≥ 0.8` 里的 ≥ 全都**从稿子上消失**。实测：45 处。
// 换 lualatex 不是解：它只是把 error 降级成 `Missing character` 警告（lmroman 无希腊/数学字形，156 处），照丢。
// 所以改在**源里**写成数学模式 —— 这样 pdflatex / lualatex / xelatex 都排得出，arXiv 换引擎也不受影响。
// 已核：这些字符在 draft.md 里**没有一处落在 code span 内**（落进去会被当字面量，不能这么换）。
// ⚠️ 别写成 markdown 的 `$…$`：pandoc 的 `$…$` 规则要求**收尾的 `$` 后面不能紧跟数字**
//（否则 "$5 and $10" 会被当成公式），而这里恰好全是 `≥1` `≈4%` 这种紧贴数字的用法
// ⇒ pandoc 不当公式，原样吐 `\$\geq\$1`，LaTeX 再报 `Missing $ inserted`（实测 11 处）。
// `\(…\)` 也不行：默认扩展下 pandoc 会把反斜杠吃掉，变成正文里的 `(\geq)`。
// 用 `\ensuremath{…}` —— raw_tex 原样透传，且**文内/数学模式都能用**（这正是它的用途）。
const SYMBOLS = [
  [/κ/g, '\\ensuremath{\\kappa}'],              // κ
  [/≥/g, '\\ensuremath{\\geq}'],                // ≥
  [/≤/g, '\\ensuremath{\\leq}'],                // ≤
  [/≈/g, '\\ensuremath{\\approx}'],             // ≈
  [/↔/g, '\\ensuremath{\\leftrightarrow}'],     // ↔
  [/⇒/g, '\\ensuremath{\\Rightarrow}'],         // ⇒
  [/⊆/g, '\\ensuremath{\\subseteq}'],           // ⊆
  [/−/g, '-'],                                  // − (U+2212 减号，实测都是数值区间 0.7−0.9，用 ASCII 连字符)
  [/⚠️?/g, '!'],                           // ⚠️
]
const symbolCounts = []
for (const [re, to] of SYMBOLS) {
  const n = (out.match(re) || []).length
  if (n) symbolCounts.push(`${re.source}→${to} ×${n}`)
  out = out.replace(re, to)
}

// ---- 3) 引用改指 PNG（独立成行的指针 → 真图片；行内的也换扩展名）----
// ⚠️ 收尾用 `[ \t]*$` 而不是 `\s*$`：`\s` 会吃掉后面的空行，把图片行贴到下一块（表/段/列表）上
// ⇒ pandoc 那边会多绕一步（实测 tex 仍出 longtable，但这是运气，不是保证）。
out = out.replace(/^Figure `figures\/([^`]+)\.svg`\.[ \t]*$/gm, (_m, f) => `![](../figures/${f}.png)`)
out = out.replace(/figures\/([A-Za-z0-9\-]+)\.svg/g, '../figures/$1.png')

const han = (out.match(/[\u4e00-\u9fff]/g) || []).length
writeFileSync(join(ROOT, 'report', 'draft-en.md'), out, 'utf8')
console.log(`WROTE report/draft-en.md · dropped ${dropped} lines of Chinese abstract · D先生→D ×${nameFixes} · remaining Han chars: ${han}`)
if (symbolCounts.length) console.log('  符号改数学模式：' + symbolCounts.join(' · '))
for (const r of report) console.log('  ' + r)

// ---- 判据 1：已知排不出的符号必须一个不剩 ----
// 这不是白名单（不列「允许什么」），是一张**已知答案的危害清单**：上面那批字符是实测会**静默丢字**的，
// 漏掉任何一个都说明替换没盖住 ⇒ 直接拦下。将来出现新符号它不会自动知道
// （这是已知缺陷，不是「扫不到就没事」）；补法是往 SYMBOLS 里加一条。
const HAZARD = /[κ≥≤≈↔⇒⊆−⚠️]/
const leftover = HAZARD.exec(out)

// ---- 判据 2：表必须活着抵达 draft-en.md ----
// 2026-09-20 的实际事故：draft.md 被插空（每行后多一个空行），GFM 表的分隔行与表头之间隔了空行
// ⇒ **6 张表全废**，pandoc 不再生成 longtable，PDF 上印出字面量 `Quantity \textbar{} Value …`。
// 当时全树的判据一条都不会响：生成器只查汉字、红线扫描器只查泄漏。这里补上。
const isSep = (l) => /^\|[-: |]+\|[ \t]*$/.test(l)
// 绝对判据（不跟源比）：GFM 要求表的**分隔行必须紧跟在表头下一行**。
// 分隔行上面是空行 ⇒ 这张表已经散了。这条**不依赖源是好的** —— 源自己坏了它也响。
const orphanSeps = (t) => {
  const ls = t.split('\n')
  return ls.flatMap((l, i) => (isSep(l) && (i === 0 || !/^\|.*\|[ \t]*$/.test(ls[i - 1])) ? [i + 1] : []))
}
const countTables = (t) => {
  const ls = t.split('\n')
  return ls.filter((l, i) => isSep(l) && i > 0 && /^\|.*\|[ \t]*$/.test(ls[i - 1])).length
}
// ⚠️ 这里是**相对**判据（源 vs 产物），单用它是不够的：源自己坏掉时 0 张 vs 0 张 = 不响。
// （这不是假设 —— 第一版就只写了这条，拿真正坏掉的 draft.md 做正对照，它照样 exit 0。）
// 所以下面两条一起用：orphan 数说「源有没有散」，张数说「路上有没有丢」。
const tSrc = countTables(readFileSync(join(ROOT, 'report', 'draft.md'), 'utf8'))
const tOut = countTables(out)
const orphanSrc = orphanSeps(readFileSync(join(ROOT, 'report', 'draft.md'), 'utf8'))
const orphanOut = orphanSeps(out)
console.log(`  表（表头紧邻分隔行）：源 ${tSrc} 张 · 产物 ${tOut} 张 · 散掉的分隔行：源 ${orphanSrc.length} 处 · 产物 ${orphanOut.length} 处`)
if (han > 0) { console.error('❌ 还有汉字，pdflatex 会炸'); process.exit(3) }
if (leftover) {
  console.error(`❌ 还有排不出的符号残留在 draft-en.md：U+${leftover[0].codePointAt(0).toString(16).toUpperCase()}（pdflatex 会静默丢掉它）`)
  process.exit(3)
}
if (orphanSrc.length) {
  console.error(`❌ draft.md 有 ${orphanSrc.length} 处分隔行前面是空行（第 ${orphanSrc.slice(0, 6).join(', ')} 行）—— 表已散，pandoc 排不出表`)
  process.exit(3)
}
if (orphanOut.length) {
  console.error(`❌ draft-en.md 有 ${orphanOut.length} 处分隔行前面是空行（第 ${orphanOut.slice(0, 6).join(', ')} 行）`)
  process.exit(3)
}
if (tOut < tSrc) {
  console.error(`❌ draft.md 里有 ${tSrc} 张表，draft-en.md 只活下来 ${tOut} 张 —— 表在路上丢了`)
  process.exit(3)
}
