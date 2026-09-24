#!/usr/bin/env node
/**
 * survival-tally-per-rater.mjs —— 把「约束的语义存活」曲线**按判读者分列**（带子从哪来）。
 *
 * 为什么另起一份而不是改 `semantic-survival-tally.mjs`：那一份是**合并口径**（把所有 answers
 * 文件加在一起数），它答的是「这一跑给出多少」；这一份答的是「**换一批判读者，这一点会动多少**」，
 * 所以每个判读者（每个文件）算一条曲线，再给 min–max 带子。两份并列读，不改旧的那份。
 *
 * 输入：两个目录，各放**一份 pack 一个文件**的判读结果（行形如 `B2 3 | 原样 | 依据`）
 *   --pass1 <dir>   第一跑（默认 ~home/tmp/semantic-survival/answers，一人一份 pack）
 *   --pass2 <dir>   第二跑（默认 ~home/tmp/semantic-survival/answers2，**同样一人一份 pack**）
 * 输出：每跑每个 k 的「意思还在」占比（= 原样 + 改措辞但还在），逐判读者 + 带子 + 多数票。
 *
 * 自检（已知答案，写死）：**pass1 的 k=1 必须是 91%**（fig2 语义曲线第一点）——对不上非零退出。
 * 守卫：任一所报的点若样本为 0 ⇒ 打印「不适用」并 exit 3，绝不用 0% 冒充（空 ≠ 零）。
 */
import { readFileSync, readdirSync, existsSync, writeFileSync as writeFileSync2 } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { homedir } from 'node:os'

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
// ⚠️ 判读语料**不随树发布**，所以这里**不写任何本机路径**（连「工具默认目录」也不写）：
// 目录一律由调用方给（`--packs <dir>` 或环境变量 `SURVIVAL_DIR`），缺了就报错退出。
// 这样红线自检（`tools/check-redline.mjs`）在这份文件上不需要任何豁免。
const BASE = argOf('--packs', process.env.SURVIVAL_DIR || '')
if (!BASE) {
  console.error('需要 --packs <dir> 或环境变量 SURVIVAL_DIR：判读语料目录不随树发布，必须显式给。')
  process.exit(3)
}
const DIR1 = argOf('--pass1', join(BASE, 'answers'))
// ⚠️ 语料里有一对**逐字节相同**的 pack（两个文件名装的是同一个会话：
// 两份文件装的是同一个会话（本机代号 A ≡ 代号 B；MD5 同为 3FA019A8C7）⇒ 直接池化会把
// 同一个会话算两遍。所以两读并列：**含重复**（与 fig2 现有口径一致）与**折叠重复**。
const PACKS = argOf('--packs', BASE)
const packHash = (name) => {
  const p = join(PACKS, `${name}.md`)
  return existsSync(p) ? createHash('md5').update(readFileSync(p)).digest('hex').slice(0, 10) : null
}
// ⚠️ pass2 可以是**逗号分隔的多个目录**：第二跑有意分了两组窗口判同一批格（每格 2 份新判读），
// 与第一跑那份合起来是 3 个判读者 ⇒ 多数票才有意义、带子才量得到。
const DIR2S = argOf('--pass2', `${join(BASE, 'answers2')},${join(BASE, 'answers2b')}`).split(',').map((s) => s.trim()).filter(Boolean)
const ALIVE = new Set(['原样', '改措辞但还在'])
const LINE = /^\s*#*\s*B(\d+)\s+(\d+)\s*\|\s*(原样|改措辞但还在|没了)\s*\|/

/** 一个目录 → [{file, hash, cells: Map('B<k>:<id>' → 状态)}]（一份 pack 一个判读者） */
function readDir(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const cells = new Map()
    for (const line of readFileSync(join(dir, f), 'utf8').split(/\r?\n/)) {
      const m = LINE.exec(line)
      if (m) cells.set(`B${m[1]}:${m[2]}`, m[3])
    }
    const base = f.replace(/\.md$/, '')
    return { file: base.slice(0, 44), base, hash: packHash(base), cells }
  })
}

/**
 * 折叠**逐字节相同的 pack**：同一会话只留一个**文件名**，判读者全留。
 * ⚠️ 这里的第一版写错过（2026-09-19）：按 hash 把 raters 折叠成一个 ⇒ **把同一份 pack 的
 * 多个判读者当成重复丢掉了**（打印里同一文件名重复三遍就是症状）。重复的是**会话**，不是判读。
 */
function foldDuplicates(raters) {
  const byHash = new Map()
  for (const r of raters) {
    if (!r.hash) continue
    if (!byHash.has(r.hash)) byHash.set(r.hash, new Set())
    byHash.get(r.hash).add(r.base)
  }
  const dropped = new Set()
  const groups = []
  for (const [h, baseSet] of byHash) {
    const bases = [...baseSet].sort((a, b) => a.localeCompare(b))
    if (bases.length < 2) continue
    groups.push({ hash: h, keep: bases[0], drop: bases.slice(1) })
    for (const b of bases.slice(1)) dropped.add(b)
  }
  return { dropped, groups }
}

const pct = (a, n) => (n === 0 ? 'n/a' : `${((100 * a) / n).toFixed(1)}%`)

function curvePerRater(raters, label) {
  console.log(`\n【${label}】逐判读者（每格 = 该判读者在这一个 k 上判「意思还在」的比例）`)
  const byK = new Map()
  for (const r of raters) {
    const row = new Map()
    for (const [key, st] of r.cells) {
      const k = Number(key.slice(1, key.indexOf(':')))
      const t = row.get(k) || { alive: 0, n: 0 }
      t.n++; if (ALIVE.has(st)) t.alive++
      row.set(k, t)
    }
    const ks = [...row.keys()].sort((a, b) => a - b)
    console.log(`  ${r.file.padEnd(46)} ` + ks.map((k) => `k${k} ${pct(row.get(k).alive, row.get(k).n)}(${row.get(k).n})`).join('  '))
    for (const k of ks) {
      const t = row.get(k)
      if (!byK.has(k)) byK.set(k, [])
      byK.get(k).push({ file: r.file, alive: t.alive, n: t.n })
    }
  }
  const ks = [...byK.keys()].sort((a, b) => a - b)
  for (const k of ks) {
    const xs = byK.get(k).filter((x) => x.n > 0)
    if (!xs.length) { console.log(`  ⚠️ k=${k} 一个样本都没有 —— 不报数（空 ≠ 零）`); continue }
    const ps = xs.map((x) => (100 * x.alive) / x.n)
    const lo = Math.min(...ps), hi = Math.max(...ps)
    const mean = ps.reduce((a, b) => a + b, 0) / ps.length
    const A = xs.reduce((s, x) => s + x.alive, 0), N = xs.reduce((s, x) => s + x.n, 0)
    console.log(`  → k=${k}：${xs.length} 份判读 · **带子 ${lo.toFixed(1)}%–${hi.toFixed(1)}%（宽 ${(hi - lo).toFixed(1)}pp）** · 均值 ${mean.toFixed(1)}% · 合并 ${pct(A, N)}(${A}/${N})`)
  }
  return { byK, ks }
}

/**
 * 多数票：按 **(会话, k, 编号)** 汇总所有判读者的状态，取出现 ≥2 次且唯一最高的那个；否则记 split。
 * ⚠️ 键必须带会话名（2026-09-19 实测：只按 `B<k>:<id>` 会把不同会话的同号格并成一格——
 * 症状是多数票那一列的 n 只有 8/9，而那 8/9 是「编号的最大值」，不是格数）。
 */
function majority(raters, label) {
  const tally = new Map()
  for (const r of raters) for (const [key, st] of r.cells) {
    const k = `${r.base}|${key}`
    if (!tally.has(k)) tally.set(k, [])
    tally.get(k).push(st)
  }
  const byK = new Map()
  let split = 0
  const nobody = []
  for (const [key, states] of tally) {
    if (states.length < 2) { nobody.push(key); continue }
    const cnt = {}
    for (const s of states) cnt[s] = (cnt[s] || 0) + 1
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])
    if (top.length > 1 && top[0][1] === top[1][1]) { split++; continue }
    const cell = key.slice(key.indexOf('|') + 1)          // 'B<k>:<id>'（会话前缀已剥）
    const k = Number(cell.slice(1, cell.indexOf(':')))
    const t = byK.get(k) || { alive: 0, n: 0 }
    t.n++; if (ALIVE.has(top[0][0])) t.alive++
    byK.set(k, t)
  }
  const ks = [...byK.keys()].sort((a, b) => a - b)
  console.log(`\n【${label}·多数票】` + ks.map((k) => `k${k} ${pct(byK.get(k).alive, byK.get(k).n)}(${byK.get(k).n})`).join('  ') + `  · 无多数 ${split} 格`)
  if (nobody.length) console.log(`  （只有 1 份判读、进不了多数票的格：${nobody.length}）`)
  return { byK, ks }
}

const r1 = readDir(DIR1)
const r2 = DIR2S.flatMap((d) => readDir(d))
// ⚠️ 词表外的行会被静默丢掉（2026-09-19 实测：第一跑里有 1 条 `B4 2 | 没法判 | …`，
// 于是 pass1 的 k=4 是 45 格而第二跑是 46 —— 差异的**全部**来源就是它）。
// 所以这里必须显化：丢掉的行数 + 原文，别让「少一格」看起来像「那格不存在」。
const offVocab = []
for (const dir of [DIR1, ...DIR2S]) {
  if (!existsSync(dir)) continue
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    for (const line of readFileSync(join(dir, f), 'utf8').split(/\r?\n/)) {
      if (/^\s*#*\s*B\d+\s+\d+\s*\|/.test(line) && !LINE.test(line)) offVocab.push(`${f} · ${line.trim().slice(0, 90)}`)
    }
  }
}
if (offVocab.length) {
  console.log(`\n⚠️ 跳过 ${offVocab.length} 条**不在三态词表里**的行（它们不进任何计数）：`)
  for (const s of offVocab) console.log(`   ${s}`)
}
console.log(`pass1 目录: ${DIR1} → ${r1.length} 份判读`)
console.log(`pass2 目录: ${DIR2S.join(' · ')} → ${r2.length} 份判读`)
if (!r1.length) { console.error('⚠️ pass1 一份都没读到 —— 先确认目录（这不是「0% 存活」）。'); process.exit(3) }
const c1 = curvePerRater(r1, 'pass1（第一跑）')
let c2 = null, m2 = null
if (r2.length) { c2 = curvePerRater(r2, 'pass2（第二跑 · 两组新判读）'); m2 = majority([...r1, ...r2], '多数票 · 全体判读者') } else { console.log('\n（pass2 还没到 —— 第二跑在跑；本脚本对它是「未适用」，不是 0）') }

// ---- 折叠逐字节相同的 pack：两读并列（含重复 / 折叠重复）----
const fold = foldDuplicates([...r1, ...r2])
let c1f = null, c2f = null, m2f = null
if (fold.groups.length) {
  console.log('\n【折叠重复 pack】逐字节相同的会话只留第一个（按文件名排序）：')
  for (const g of fold.groups) console.log(`  md5 ${g.hash}：留 \`${g.keep}\` · 丢 ${g.drop.map((d) => `\`${d}\``).join(' · ')}`)
  const r1f = r1.filter((r) => !fold.dropped.has(r.base))
  const r2f = r2.filter((r) => !fold.dropped.has(r.base))
  c1f = curvePerRater(r1f, 'pass1（折叠后）')
  if (r2f.length) { c2f = curvePerRater(r2f, 'pass2（折叠后）'); m2f = majority([...r1f, ...r2f], '多数票 · 折叠后') }
} else {
  console.log('\n（语料里没有逐字节相同的 pack —— 无需折叠）')
}

/** byK（k → [{alive,n}]）→ { pooled:[alive,n], band:[lo,hi], mean, raters:[%] } */
/**
 * byK → JSON 片段。⚠️ **两种形状必须分开吃**（2026-09-19 实测：混着吃当场 TypeError 崩掉）：
 *   · 逐判读者那半边：k → [{file, alive, n}]（数组）⇒ 能算池化、带子、均值
 *   · 多数票那半边：  k → {alive, n}（对象）⇒ 只有一个池化数，**没有带子**（带子来自判读者之间）
 */
const summarize = (byK, ks) => Object.fromEntries(ks.map((k) => {
  const v = byK.get(k)
  if (Array.isArray(v)) {
    const xs = v.filter((x) => x && x.n > 0)
    const A = xs.reduce((s, x) => s + x.alive, 0), N = xs.reduce((s, x) => s + x.n, 0)
    const ps = xs.map((x) => Math.round((10000 * x.alive) / x.n) / 100)
    return [`k${k}`, {
      kind: 'per-rater',
      pooled: [A, N], pooledPct: N ? Math.round((10000 * A) / N) / 100 : null,
      band: ps.length ? [Math.min(...ps), Math.max(...ps)] : null,
      meanPct: ps.length ? Math.round((ps.reduce((a, b) => a + b, 0) / ps.length) * 100) / 100 : null,
      raters: ps,
    }]
  }
  if (!v || !v.n) return [`k${k}`, { kind: 'majority', pooled: [0, 0], pooledPct: null, band: null, meanPct: null, raters: [] }]
  return [`k${k}`, {
    kind: 'majority',
    pooled: [v.alive, v.n], pooledPct: Math.round((10000 * v.alive) / v.n) / 100,
    band: null, meanPct: null, raters: [],
  }]
}))
const OUT = join(BASE, 'survival-bands.json')
const payload = {
  generatedAt: new Date().toISOString(),
  note: '带子是**判读者之间**的散布（每份判读一条曲线）。会话之间的散布是另一件事，别混。',
  pass1: summarize(c1.byK, c1.ks),
  pass2: c2 ? summarize(c2.byK, c2.ks) : null,
  majority: m2 ? summarize(m2.byK, m2.ks) : null,
}
writeFileSync2(OUT, JSON.stringify(payload, null, 2) + '\n')
console.log(`WROTE ${OUT}`)

const k1 = c1.byK.get(1)
const alive1 = k1.reduce((s, x) => s + x.alive, 0), n1 = k1.reduce((s, x) => s + x.n, 0)
const rate1 = Math.round((100 * alive1) / n1)
const ok = rate1 === 91
console.log(`\n自检：pass1 的 k=1 合并存活率应 = 91%（fig2 语义曲线第一点）⇒ 实为 ${rate1}% ⇒ ${ok ? '✓ 通过' : '✗ 不通过'}`)
if (!ok) process.exit(3)
