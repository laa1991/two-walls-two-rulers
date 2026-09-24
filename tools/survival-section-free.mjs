#!/usr/bin/env node
// survival-section-free.mjs —— **无节结构**版本的约束存活（跨 harness 可比的那一版）
//
// 为什么要另开一个脚本（而不是给 `constraint-survival.mjs` 加开关）：
//   本树的约定是「**换阈值 / 换条目切分 = 换脚本名**」（README 复现门槛那条）。
//   而这次换的正是**条目切分** —— 所以它是新脚本，不是同一个脚本的第二种模式。
//
// 为什么需要它（2026-09-19 实测）：`constraint-survival.mjs` 的切分依赖 `## Boundaries`
//   这一节。把同一把尺搬到第二个 harness 的原生 transcript 上，`b@1 = 0 / miss = 29` ——
//   那份摘要**一个 `##` 标题都没有**（29/29 代都没有）。⇒ 那台尺在那边**抽不出条目**，
//   于是「跨实现」在存活曲线这一格上无从并排 —— 除非把「条目」的定义换成**不依赖节结构**的。
//
// 判据（写死在这里；与 `constraint-survival.mjs` 只差**条目来源**这一条）：
//   · 条目 = 摘要全文里**行首为 `-` 或 `*` 的 bullet 行**（去掉标记、trim、长度 >= 8）
//   · 存活 = 归一化后 5-gram 包含度 >= 0.8（与那台尺逐字相同，别改成两把尺）
//   · 归一化：小写 + 折叠空白 + 去反引号/星号/引号（同上）
//   · 第 1 代**第一个非空条目集**作为基准；曲线 = 第 k 代里仍存活的基准条目占比
// ⚠️ 两边的条目**语义不同**：dsh 那边 `## Boundaries` 里是红线，而这里把摘要里**任何**一节的
//   bullet 都算进来（任务态、决定、文件清单…）。所以这个量量的是「bullet 级条目的逐字存活」，
//   不是「约束的存活」—— 报的时候必须连着这句限定一起报。
//
// 用法：node survival-section-free.mjs <dump.json> [<dump.json> ...]
//      node survival-section-free.mjs            # 扫 %TEMP%\compaction-*.json

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const TMP = process.env.TEMP || '.'
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(TMP).filter((f) => f.startsWith('compaction-') && f.endsWith('.json')).map((f) => join(TMP, f))

const norm = (s) => s.toLowerCase().replace(/[`*_"'“”‘’]/g, '').replace(/\s+/g, ' ').trim()
const grams = (s, n = 5) => {
  const set = new Set()
  const t = norm(s)
  if (t.length < n) return set
  for (let i = 0; i + n <= t.length; i++) set.add(t.slice(i, i + n))
  return set
}
const cover = (a, b) => {
  if (a.size === 0) return norm(b).includes(norm(a)) ? 1 : 0
  let hit = 0
  for (const g of a) if (b.has(g)) hit++
  return hit / a.size
}
const bullets = (text) => String(text ?? '')
  .split(/\r?\n/)
  .filter((l) => /^\s*[-*]\s+/.test(l))
  .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
  .filter((l) => l.length >= 8)

const rows = []
for (const f of files) {
  let J
  try { J = JSON.parse(readFileSync(f, 'utf8')) } catch { continue }
  const gens = (J.rows || []).map((r) => r.sum).filter((s) => typeof s === 'string' && s.trim())
  if (gens.length < 3) continue
  const perGen = gens.map((s) => bullets(s))
  const first = perGen.find((b) => b.length) || []
  const curve = []
  for (let k = 0; k < gens.length; k++) {
    const hereGrams = (perGen[k] || []).map((b) => grams(b))   // ⚠️ 必须包一层箭头：`.map(grams)` 会把**索引**当 n 传进去
    let alive = 0
    for (const b of first) {
      const bg = grams(b)
      let best = 0
      for (const hg of hereGrams) best = Math.max(best, cover(bg, hg))
      if (best >= 0.8) alive++
    }
    curve.push(first.length ? alive / first.length : null)
  }
  rows.push({ file: f.split(/[\\/]/).pop().replace('compaction-', '').replace('.json', ''), gens: gens.length, firstBullets: first.length, firstIsGen1: perGen[0] === first, curve })
}

const pct = (x) => (x === null || x === undefined ? '  -  ' : (x * 100).toFixed(0).padStart(3) + '%')
console.log('session'.padEnd(46), 'gens', 'b@1', 'curve (k=1..N = % of gen-1 bullets still present, 5-gram >= 0.8)')
for (const r of rows.sort((a, b) => b.gens - a.gens)) {
  console.log(r.file.padEnd(46), String(r.gens).padStart(4), String(r.firstBullets).padStart(4), r.curve.map(pct).join(' '))
}

// —— 自检：第 0 格是「基准条目与它自己比」，**必须是 100%** ——
// 这一条是当天加的：本脚本第一版把 `.map(grams)` 写成数组方法的回调，`grams(s, n=5)` 的 n
// 收到了**索引**（0,1,2,…）⇒ 除第一个条目外全部匹配失败，曲线从第 0 格起就全是 ~0%，
// 而它**看起来像一条发现**（「两个 harness 的条目都活不过一轮」）。自检就是那份「我知道
// 期望输出的输入」，这次输入是**曲线自己的第 0 格**。
const bad = rows.filter((r) => r.firstIsGen1 && r.firstBullets > 0 && Math.abs((r.curve[0] ?? 0) - 1) > 1e-9)
if (bad.length) {
  console.log(`\n⚠️ 自检失败：${bad.length} 份会话的 k=0 不是 100% —— 基准条目没能在自己那一代里匹配上自己。`)
  console.log('   这意味着**条目切分或匹配口径坏了**，上面的曲线一律不作数（exit 3）。')
  process.exit(3)
}
console.log(`\n自检 ✓：${rows.filter((r) => r.firstBullets > 0).length} 份会话的 k=0 都是 100%（基准与自身可比）`)
console.log('')
const at = (k) => rows.map((r) => r.curve[k]).filter((v) => v !== null && v !== undefined)
for (const k of [1, 2, 3, 4, 5]) {
  const v = at(k)
  if (!v.length) continue
  console.log(`k=${k}: mean-of-ratios ${pct(v.reduce((a, b) => a + b, 0) / v.length)} (n=${v.length})`)
}
console.log('\n⚠️ 这个量是「bullet 级条目」的逐字存活，不是「约束」的存活 —— 引用时必须连着这句。')
