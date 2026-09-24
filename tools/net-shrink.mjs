#!/usr/bin/env node
/**
 * net-shrink.mjs —— 「成功的压缩里，有多少其实**没缩小**」（2026-09-20 立）
 *
 * 为什么：`no-shrink` 只在**极端**才报错（`compaction/end.error` 里那句 "summary is not smaller than the
 * shadowed content (A estimated framed tokens >= B)"）。203 次**成功**的压缩里有没有净负的，此前没人算。
 *
 * 取值（两条通道，必须一起读）：
 *   遮蔽侧 = `compaction/summary.shadowedTokenCount`（**harness 自己的估计**）
 *   摘要侧 = 同一个 `compaction/summary.usage.outputTokens`（**provider 报的 usage**）
 *   ⇒ 两侧**不是同一把尺**：这正是正文 §2 那类 token-meter 错配的同族；所以下面同时打印
 *     摘要正文的字符数（第三把尺，chars/4 的粗估），让「差多少是通道差、差多少是内容差」看得见。
 *
 * 判据（自检，写死）：
 *   ① 解析失败侧那 15 条 no-shrink 错误的两个数：A ≥ B 必须成立，否则 exit 3（解析错了）；
 *   ② 任何会话里 `compaction/summary` 缺 `usage.outputTokens` 或 `shadowedTokenCount` 的，
 *      计入 `noData` 并**逐条打印**（不补 0、不静默丢）。
 *
 * 用法：node net-shrink.mjs [--scope <workspace 子串>] [--quiet]
 */
import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { homedir } from 'node:os'
import { decodeAny, sessionFilesUnder } from './foreign-log-adapter.mjs'

const ROOT = process.env.DSH_SESSIONS_DIR || join2(homedir(), '.dsh', 'sessions')
function join2(a, b, c) { return [a, b, c].filter(Boolean).join(a.includes('\\') ? '\\' : '/') }
const argv = process.argv.slice(2)
const quiet = argv.includes('--quiet')
const si = argv.indexOf('--scope')
const scope = si >= 0 ? (argv[si + 1] || '') : ''

const textOf = (blocks) => (blocks ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')

const rows = []          // 每次成功压缩一行
const fails = []         // 失败侧：{session, A, B, ratio}
const noData = []

for (const f of sessionFilesUnder(ROOT)) {
  const parts = f.rel.split('/')
  const ws = parts[0]
  const id = parts.length >= 2 ? parts[parts.length - 2] : f.name
  if (scope && !ws.includes(scope)) continue
  const byId = new Map()      // compactionId → { shadow, out, chars, error }
  let evCount = 0
  try {
    decodeAny(basename(f.path), readFileSync(f.path), (o) => {
      evCount++
      const d = o.data ?? {}
      if (o.type === 'compaction/summary') {
        const cid = d.compactionId ?? `seq:${o.seq}`
        const rec = byId.get(cid) ?? {}
        rec.shadow = d.shadowedTokenCount
        rec.out = d.usage?.outputTokens
        rec.chars = textOf(d.summary).length   // summary 是**块数组**，不是字符串（census 同款取法）
        rec.blocks = Array.isArray(d.summary) ? d.summary.length : undefined
        rec.rawChars = typeof d.rawOutput === 'string' ? d.rawOutput.length
          : Array.isArray(d.rawOutput) ? textOf(d.rawOutput).length
            : typeof d.rawOutput === 'object' && d.rawOutput !== null ? JSON.stringify(d.rawOutput).length : undefined
        rec.model = d.model
        byId.set(cid, rec)
      }
      if (o.type === 'compaction/end') {
        const cid = d.compactionId ?? `seq:${o.seq}`
        const rec = byId.get(cid) ?? {}
        rec.error = d.error
        byId.set(cid, rec)
        if (d.error) {
          const m = /\((\d+)\s+estimated framed tokens\s+>=\s+(\d+)\)/.exec(d.error)
          if (m) fails.push({ ws, id, A: Number(m[1]), B: Number(m[2]), ratio: Number(m[1]) / Number(m[2]) })
        }
      }
    })
  } catch (e) {
    console.error(`⚠️ 解码失败（不静默跳过）：${f.rel} — ${String(e.message).slice(0, 120)}`)
    continue
  }
  for (const [cid, r] of byId) {
    if (r.error) continue                        // 失败尝试另计
    if (typeof r.shadow !== 'number' || typeof r.out !== 'number') {
      noData.push({ rel: f.rel, cid, hasShadow: typeof r.shadow === 'number', hasOut: typeof r.out === 'number' })
      continue
    }
    rows.push({ ws, id, cid, shadow: r.shadow, out: r.out, chars: r.chars, ratio: r.out / r.shadow, evCount })
  }
}

// ---- 自检 ①：失败侧 A ≥ B ----
const badControl = fails.filter((x) => !(x.A >= x.B))
console.log(`自检①（失败侧 no-shrink 的两个数必须 A ≥ B）：解析到 ${fails.length} 条 · 违反 ${badControl.length} 条 ${badControl.length === 0 ? '✓' : '❌'}`)
if (badControl.length) { for (const b of badControl.slice(0, 3)) console.log(`   ${b.ws}/${b.id} A=${b.A} B=${b.B}`); process.exit(3) }

// ---- 自检 ②：缺字段逐条打印 ----
console.log(`自检②（缺 usage/outputTokens 或 shadowedTokenCount 的成功压缩）：${noData.length} 条`)
for (const x of noData.slice(0, 10)) console.log(`   缺 shadow=${!x.hasShadow} out=${!x.hasOut} · ${x.rel} · ${x.cid}`)

// ---- 主读数 ----
const n = rows.length
const net = rows.filter((r) => r.ratio >= 1)
const zeroish = rows.filter((r) => r.ratio < 1 && r.ratio >= 0.95)
const shrink = rows.filter((r) => r.ratio < 0.95)
const med = (a) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN
console.log('')
console.log(`成功的压缩（两侧字段都在）：${n} 次`)
console.log(`  · provider 报的摘要输出 tokens ≥ harness 的遮蔽估计：${net.length} 次（${(100 * net.length / (n || 1)).toFixed(1)}%）`)
console.log(`  · 几乎持平（0.95 ≤ ratio < 1）：${zeroish.length} 次`)
console.log(`  · 确实缩小（ratio < 0.95）：${shrink.length} 次`)
console.log(`  · ratio = 摘要 usage.outputTokens ÷ shadowedTokenCount · 中位 ${med(rows.map((r) => r.ratio)).toFixed(3)} · 最大 ${Math.max(...rows.map((r) => r.ratio)).toFixed(2)} · 最小 ${Math.min(...rows.map((r) => r.ratio)).toFixed(3)}`)
const chars4 = rows.filter((r) => typeof r.chars === 'number').map((r) => (r.chars / 4) / r.shadow)
const raw4 = rows.filter((r) => typeof r.rawChars === 'number').map((r) => (r.rawChars / 4) / r.shadow)
console.log(`  · 生成侧（rawOutput 字符数 ÷ 4 ÷ 遮蔽估计）中位 ${med(raw4).toFixed(3)} —— 这一条量的是「模型吐了多少」，不是「留下了多少」；它上面那条 ratio 是 provider usage，两者差 = 生成但没留用的那部分`)
console.log(`  · 第三把尺（摘要正文字符数 ÷ 4 ÷ 遮蔽估计）中位 ${med(chars4).toFixed(3)} —— 与上面 ratio 的差 = 两条通道的差，不是内容的差`)
if (!quiet) {
  const top = rows.slice().sort((a, b) => b.ratio - a.ratio).slice(0, 8)
  console.log('')
  console.log('ratio 最高的 8 次（provider 视角下「没缩小」得最厉害的）：')
  for (const r of top) console.log(`   ${r.ratio.toFixed(2)}  shadow=${r.shadow}  out=${r.out}  chars=${r.chars}  ${r.ws}/${r.id.slice(0, 24)}`)
  const per = new Map()
  for (const r of rows) { const k = r.ws; const cur = per.get(k) ?? { n: 0, net: 0 }; cur.n++; if (r.ratio >= 1) cur.net++; per.set(k, cur) }
  console.log('')
  console.log('按 workspace：')
  for (const [k, v] of [...per].sort((a, b) => b[1].n - a[1].n)) console.log(`   ${k}  成功 ${v.n} · 其中 net≥1 ${v.net}`)
}
console.log('')
console.log(`失败侧（no-shrink 报错）${fails.length} 条 · A/B 中位 ${med(fails.map((f) => f.ratio)).toFixed(3)}（这些是 harness 自己判失败的那些）`)
