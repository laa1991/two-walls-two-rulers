#!/usr/bin/env node
/**
 * build-report.mjs —— 出稿那条链的**唯一入口**（2026-09-20 立）
 *
 * 为什么要有它：此前这条链是我在 pwsh 里手打的四步
 *   build-tex-en.mjs → pandoc → pdflatex ×2 → 清 aux/log
 * 手打的两个代价今天各付了一次：**换行归一化把空行翻倍**（六张表全废，PDF 印出字面量），
 * 以及**改了源码忘了重编**。手打链没有地方挂判据 ⇒ 判据要挂在链上，不是挂在我的记性上。
 *
 * 这条链的五道判据（都打印，任一不过 exit 3）：
 *   ① build-tex-en.mjs 自己的两道（无汉字 / 危险符号清零 / 表在 .md 里活着）—— 子进程的退出码
 *   ② **表活着抵达 .tex**：`\begin{longtable}` 的张数必须等于 draft-en.md 里的 GFK 表张数
 *      （build-tex-en 只查到 .md 一层；pandoc 那一步此前是「运气，不是保证」）
 *   ③ **PDF 真出来**：存在、非空、页数 ≥ 1
 *   ④ **编译日志里没有 Missing character / 没有 `!` 开头**：pdflatex 的静默丢字只会留一行 log
 *   ⑤ **没有肉眼可见的版面溢出**（2026-09-22 加）：`Overfull \hbox` 最宽 ≤ 2pt。
 *      这一条是**审稿人肉眼**在 PDF 上先发现的 —— `\texttt{文件名}` 不折行 ⇒ §9 装置表出右边界 24–71pt。
 *      修法＝删 `tools/` 前缀 ＋ 把第一列占比调到 0.50（pandoc 按 markdown 分隔行的**比例**分列宽，
 *      所以光删前缀不够）。判据从此拦这一类：小溢出印在纸上就是字出界，只是没人拿尺去量。
 *
 * ⚠️ pdflatex 的路径**不进树**（含用户名）：从环境变量取 `MIKTEX_BIN`（或 PDFLATEX 的完整路径）。
 * 用法：
 *   node tools/build-report.mjs                 # 出稿
 *   node tools/build-report.mjs --selftest      # 只跑表校验器的正负对照（不动树）
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPORT = join(ROOT, 'report')
const isSep = (l) => /^\|[-: |]+\|[ \t]*$/.test(l)
const isHeader = (l) => /^\|.*\|[ \t]*$/.test(l)
/** GFM 表计数：分隔行必须紧跟在表头行的下一行（绝对判据，不跟源比） */
export const countTables = (t) => {
  const ls = t.split('\n')
  return ls.filter((l, i) => isSep(l) && i > 0 && isHeader(ls[i - 1])).length
}
/** 散掉的分隔行：自己像分隔行，但上一行不是表头 ⇒ 这张表已经废了 */
export const orphanSeps = (t) => {
  const ls = t.split('\n')
  return ls.flatMap((l, i) => (isSep(l) && (i === 0 || !isHeader(ls[i - 1])) ? [i + 1] : []))
}

/** 非 ASCII **默认拒绝**：只放行实测可排的那组（= 健康 draft-en.md 里实际出现过、pdfLaTeX 排得出来的字符） */
const ALLOWED_NON_ASCII = new Set([...'·§—–“”…→÷×†'])
export const offendersIn = (t) => [...new Set((t.match(/[^\x00-\x7F]/g) ?? []).filter((c) => !ALLOWED_NON_ASCII.has(c)))]

/** 出稿的「阅读形状」（2026-09-24 加 —— 第 7 节空行事故：五道老判据全绿，而 PDF 里**字面印出** `# 7. What we do not claim`）。
 *  事故机制：`draft.md` 里一个 1110 字符的长段落与 `# 7. …` 之间缺空行 ⇒ 按 CommonMark 紧贴段落的 `#` 不是 ATX 标题
 *  ⇒ 被转义成字面量；后果四层：正文印出 `#` · 第 7 节内容并进第 6 节 · 编号 6→8 跳号 · `(§7, §8)` 悬空。
 *  为什么老判据全绿：它们量的是「有哪些字符串」（表数 / 非 ASCII / Missing character / Overfull / PDF 存在），
 *  **没有一道把产物当一篇文章读**。这一道比的是 **源 → 产物**：
 *    ① 源里每个标题都必须在产物里以**独立一行**出现（按前 40 字符判，防 pdftotext 折行）
 *    ② 产物里不许出现字面 markdown 标记（`# ` 后面跟非空白）
 *    ③ 源里的节编号必须连续（1..max 无缺号）
 *  返回三个量，任一非零即不合格。 */
export const renderShape = (srcMd, docText) => {
  const heads = (srcMd.match(/^#{1,6}[ \t]+.*$/gm) ?? []).map((h) => h.replace(/^#{1,6}[ \t]+/, '').trim())
  const lines = docText.split('\n').map((l) => l.replace(/[ \t]+$/, '').trimStart())
  const markers = docText.match(/(?:^|[^\S\n])#[ \t]+\S[^\n]*/g) ?? []
  const literalMarkers = markers.length
  const missingHeads = heads.filter((h) => !lines.some((l) => l.startsWith(h.slice(0, Math.min(40, h.length)))))
  // ③ 节编号必须连续 —— **从产物读，不从源读**（从源读是恒真的：源里当然连续，那样这道断言在真实事故上会静默报绿）。
  //    机制：一个标题没渲染成标题时，它在产物里就不再以 `<n>. ` 开头 ⇒ 那一号从产物里消失 ⇒ 缺号（事故里是 6→8）。
  const stem = (h) => { const m = /^(\d+)\./.exec(h); return m ? `${m[1]}. ${h.slice(m[0].length).trim().slice(0, 40)}` : null }
  const numbered = heads.map((h) => ({ n: Number(/^(\d+)\./.exec(h)?.[1]), stem: stem(h) })).filter((x) => Number.isFinite(x.n) && x.stem)
  const rendered = new Set(numbered.filter((x) => lines.some((l) => l.startsWith(x.stem))).map((x) => x.n))
  const maxNum = numbered.length ? Math.max(...numbered.map((x) => x.n)) : 0
  const gapInNumbers = [...Array(maxNum).keys()].map((i) => i + 1).filter((n) => !rendered.has(n))
  return { heads: heads.length, literalMarkers, markerSamples: markers.slice(0, 3).map((m) => m.trim().slice(0, 48)), missingHeads, gapInNumbers, renderedNumbers: [...rendered].sort((a, b) => a - b) }
}

if (process.argv.includes('--selftest')) {
  const good = ['| a | b |', '|---|---|', '| 1 | 2 |'].join('\n')
  const broken = ['| a | b |', '', '|---|---|', '| 1 | 2 |'].join('\n')
  const g = { tables: countTables(good), orphan: orphanSeps(good).length }
  const b = { tables: countTables(broken), orphan: orphanSeps(broken).length }
  console.log(`自检（已知答案）：好的样本 tables=${g.tables}（应为 1）orphan=${g.orphan}（应为 0）`)
  console.log(`自检（已知坏料）：空行插在表头与分隔行之间 tables=${b.tables}（应为 0）orphan=${b.orphan}（应为 1）`)
  const ok = g.tables === 1 && g.orphan === 0 && b.tables === 0 && b.orphan === 1
  console.log(ok ? '✅ 校验器正负对照都按预期响' : '❌ 校验器本身不对，先修它')
  // 非 ASCII 判据的正负对照（已知答案）：健康字符放行、危险符号拦下
  // ⚠️ 夹具本身也要干净：第一版夹具里带了汉字（那当然算「不在放行表里」）⇒ 自检假红。
  const passOk = offendersIn('plain text with § · × † — dashes').length === 0
  const passBad = offendersIn('Cohen κ = 0.27 · ≥ 0.8').length === 2
  console.log(`自检（非 ASCII 放行表）：健康字符 offenders=${passOk ? 0 : '≠0'}（应为 0）· 混入 κ/≥ offenders=${passBad ? 2 : '≠2'}（应为 2）`)
  const ok2 = ok && passOk && passBad
  console.log(ok2 ? '✅ 校验器正负对照都按预期响' : '❌ 校验器本身不对，先修它')
  // 渲染形状判据的正负对照（已知答案）：负料 = 第 7 节事故的形状（标题紧贴长段落 ⇒ 字面印出 `#`）
  const goodSrc = '# 1. Alpha\n\ntext\n\n# 2. Beta\n\nmore\n'
  const goodDoc = '1. Alpha\ntext\n2. Beta\nmore\n'
  const badDoc = '1. Alpha\ntext from theirs. # 2. Beta\nmore\n'
  const g3 = renderShape(goodSrc, goodDoc)
  const b3 = renderShape(goodSrc, badDoc)
  console.log(`自检（渲染形状 · 正）：缺标题 ${g3.missingHeads.length}（应 0）· 字面标记 ${g3.literalMarkers}（应 0）· 缺号 ${g3.gapInNumbers.length}（应 0）`)
  console.log(`自检（渲染形状 · 负）：缺标题 ${b3.missingHeads.length}（应 1）· 字面标记 ${b3.literalMarkers}（应 1）· 缺号 ${b3.gapInNumbers.length}（应 1）`)
  const ok3 = g3.missingHeads.length === 0 && g3.literalMarkers === 0 && g3.gapInNumbers.length === 0 &&
              b3.missingHeads.length === 1 && b3.literalMarkers === 1 && b3.gapInNumbers.length === 1
  console.log(ok3 ? '✅ 渲染形状判据正负对照都按预期响' : '❌ 渲染形状判据本身不对，先修它')
  process.exit(ok2 && ok3 ? 0 : 3)
}

const fail = (msg) => { console.error(`❌ ${msg}`); process.exit(3) }
const read = (p) => readFileSync(p, 'utf8')

// ---- ⓪ 环境检查放在最前（2026-09-20 第四轮复核实锤）----
// 此前 pdflatex / pandoc 两条检查排在 `build-tex-en.mjs` **之后** ⇒ 缺 MIKETEX_BIN 的那次失败，
// 已经先把 `draft-en.md` 与四张 PNG 重写了一遍（检查在它们之后，失败也要付这次重写的代价）。
// 「缺一个环境变量」这种错应该在动任何产物**之前**就落地（fail fast）。
const bin = process.env.MIKETEX_BIN || process.env.PDFLATEX_DIR || ''
const pdflatex = process.env.PDFLATEX || (bin ? join(bin, 'pdflatex.exe') : '')
if (!pdflatex) fail('没给 pdflatex：设 MIKETEX_BIN=<.../miktex/bin/x64>（路径含用户名，不进树）')
if (!existsSync(pdflatex)) fail(`pdflatex 不在：${pdflatex}`)
const pandoc = process.env.PANDOC || 'pandoc'   // 没在 PATH 上就设 PANDOC=<完整路径>（路径含用户名，不进树）
// pandoc 不在 PATH 时原先是裸 ENOENT 栈（`spawnSync pandoc ENOENT`）——读起来像脚本坏了，
// 而不是「缺一个环境变量」。判据与 pdflatex 那条同形：说清缺什么、去哪找。
if (process.env.PANDOC && !existsSync(pandoc)) fail(`PANDOC 指的文件不在：${pandoc}`)

// ---- ① 生成英文版（子进程自带它的判据）----
execFileSync(process.execPath, [join(ROOT, 'tools', 'build-tex-en.mjs')], { stdio: 'inherit', cwd: ROOT })
const enMd = join(REPORT, 'draft-en.md')
if (!existsSync(enMd)) fail('draft-en.md 没生成')
// ---- ①b 绝对判据：非 ASCII **默认拒绝**，只放行一张「已知可排」的字符表 ----
// 上面那批危险符号是一张**已知坏清单**（build-tex-en 的 SYMBOLS）；出现一个它不认识的新符号时那张清单不会响。
// 这条换成**默认拒绝**：除了下面这张「实测能被 pdfLaTeX 排出来」的字符外，任何非 ASCII 都拦下。
// ⚠️ 第一版写成「一个非 ASCII 都不许有」——当场被自己的稿子打脸：健康产物里有 322 个（·§—–“”→÷），
//    那些是 pandoc/pdfLaTeX 处理得好的字符 ⇒ **判据太严会天天响，而天天响的判据会被人绕过**。
const nonAscii = read(enMd).match(/[^\x00-\x7F]/g) ?? []
const offenders = offendersIn(read(enMd))
console.log(`  非 ASCII 字符：${nonAscii.length} 处 · 其中不在放行表里的：${offenders.length} 处${offenders.length ? '（' + offenders.slice(0, 8).join('') + '）' : ''}`)
if (offenders.length) fail(`draft-en.md 里有不在放行表里的非 ASCII：${offenders.slice(0, 8).join(' ')} —— pdflatex 会静默丢掉或直接炸；补进 build-tex-en.mjs 的 SYMBOLS 表，或（确认可排后）加进本文件的放行表`)

// ---- ② 表数一致性（.md → .tex 不是运气）----
// pdflatex / pandoc 的存在性检查已在 ⓪ 里做过，这里直接用。
const tMd = countTables(read(enMd))
const texPath = join(REPORT, 'draft-en.tex')
try {
  execFileSync(pandoc, [enMd, '-o', texPath, '--standalone'], { stdio: 'inherit', cwd: ROOT })
} catch (e) {
  fail(`pandoc 没跑起来（${e.code ?? e.message}）：设 PANDOC=<完整路径>；本机随 pypandoc 自带，在 <python>\\Lib\\site-packages\\pypandoc\\files\\pandoc.exe（路径含用户名，不进树）`)
}
const tex = read(texPath)
const tTex = (tex.match(/begin\{longtable\}/g) ?? []).length
const stray = (tex.match(/\\textbar\{\}/g) ?? []).length
console.log(`  表：draft-en.md ${tMd} 张 · draft-en.tex longtable ${tTex} 个 · tex 里 \`\\textbar{}\` 字面量 ${stray} 处`)
if (tMd !== tTex) fail(`表在 pandoc 那一步丢了：.md ${tMd} 张 ≠ .tex ${tTex} 个 longtable`)

// ---- ③ 编译两次 + 读 log ----
const outDir = process.env.PDF_OUT_DIR || REPORT
const run = (extra = []) => execFileSync(pdflatex, ['-interaction=nonstopmode', '-file-line-error', ...extra, 'draft-en.tex'], { cwd: REPORT, stdio: 'pipe' })
run(); const second = run().toString()
const logPath = join(REPORT, 'draft-en.log')
const log = existsSync(logPath) ? read(logPath) : ''
const missing = (log.match(/Missing character/g) ?? []).length
const bangs = (log.match(/^!/gm) ?? []).length
// 版面溢出（2026-09-22 加 —— 这一条是审稿人**肉眼**在 PDF 上发现的）：`\texttt{文件名}` 不折行 ⇒ 表格出右边界。
// 阈值 2pt：比这更小的溢出在纸上不可见；当初那一族是 24–71pt，肉眼一望即知。
const overfull = (log.match(/^Overfull \\hbox \(([\d.]+)pt too wide\)/gm) ?? []).map((l) => Number(/\(([\d.]+)pt/.exec(l)[1]))
const worstOverfull = overfull.length ? Math.max(...overfull) : 0
console.log(`  编译日志：Missing character ${missing} 处 · 以 ! 开头的报错 ${bangs} 条 · Overfull \\hbox ${overfull.length} 处${overfull.length ? `（最宽 ${worstOverfull.toFixed(1)}pt）` : ''}`)

// ---- ④ PDF 真出来 + 清场 ----
const pdf = join(REPORT, 'draft-en.pdf')
if (!existsSync(pdf) || statSync(pdf).size < 10_000) fail('draft-en.pdf 没出来或太小')
const pages = (readFileSync(pdf, 'latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
console.log(`  PDF：${statSync(pdf).size} B · 页数≈${pages}`)
if (missing > 0 || bangs > 0) fail('编译日志里有丢字/报错：见 report/draft-en.log（这一轮先不清场，留着证据）')
if (worstOverfull > 2) fail(`版面溢出 ${worstOverfull.toFixed(1)}pt（> 2pt 肉眼可见）：grep '^Overfull' report/draft-en.log（这一轮先不清场）`)
// ---- ⑤ 出稿的阅读形状（2026-09-24 加；这一条是审稿窗口用 pdftotext 发现的第 7 节事故）----
// 判据形状：**源 → 产物**（源里每个标题都要在产物里成一行；产物里不许有字面 markdown 标记；节编号不许跳号）。
const pdftotext = process.env.PDFTOTEXT || (bin ? join(bin, 'pdftotext.exe') : '')
if (!pdftotext || !existsSync(pdftotext)) fail('没找到 pdftotext：设 PDFTOTEXT=<.../pdftotext.exe>（第 ⑤ 道判据要靠它把 PDF 读成文本）')
const txtOut = join(REPORT, 'draft-en.txt')
execFileSync(pdftotext, ['-layout', pdf, txtOut], { stdio: 'pipe' })
const shape = renderShape(read(enMd), read(txtOut))
rmSync(txtOut, { force: true })
console.log(`  阅读形状：源标题 ${shape.heads} 个 · 产物里没成行的 ${shape.missingHeads.length} 个${shape.missingHeads.length ? '（' + shape.missingHeads.slice(0, 3).join(' / ') + '）' : ''} · 字面 markdown 标记 ${shape.literalMarkers} 处${shape.literalMarkers ? '（' + shape.markerSamples.join(' | ') + '）' : ''} · 节编号缺 ${shape.gapInNumbers.join(',') || '无'}`)
if (shape.missingHeads.length || shape.literalMarkers || shape.gapInNumbers.length) {
  fail('出稿的「阅读形状」不合格（标题没成标题 / 印出字面 markdown / 节编号跳号）—— 见上面那行三个读数；这一类错老五道判据全都看不见')
}
for (const junk of readdirSync(REPORT)) {
  if (/\.(aux|log|out|toc)$/.test(junk)) { rmSync(join(REPORT, junk), { force: true }); console.log(`  清掉 ${junk}`) }
}
console.log('✅ 出稿完成：report/draft-en.pdf')
