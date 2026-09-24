// probe-toolcalls.mjs —— 从一支探针自己的会话日志里数「它调了什么工具」（v2 搜索列的观测面）
// 用法: node probe-toolcalls.mjs <session.jsonl.zstd> [...]
// 判据只在 SEARCH-TOOLS.md：命中「算搜」名单里的工具 ⇒ 计一次搜。
// 解码复用 compaction-census.mjs 的那 25 行（多帧 zstd：magic 扫描 → 逐帧解 → 逐行 JSON.parse）。
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

function decodeFrames(raw, onLine) {
  const starts = []
  for (let i = 0; i < raw.length - 3; i++) {
    if (raw[i] === MAGIC[0] && raw[i + 1] === MAGIC[1] && raw[i + 2] === MAGIC[2] && raw[i + 3] === MAGIC[3]) starts.push(i)
  }
  let carry = ''
  let lines = 0
  let fail = 0
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : raw.length
    let text
    try { text = zstdDecompressSync(raw.subarray(starts[k], end)).toString('utf8') } catch { continue }
    const parts = (carry + text).split('\n')
    carry = parts.pop() ?? ''
    for (const p of parts) {
      if (!p) continue
      lines++
      let obj = null
      try { obj = JSON.parse(p) } catch { fail++; continue }
      onLine(obj)
    }
  }
  if (carry) { try { onLine(JSON.parse(carry)) } catch { fail++ } }
  return { frames: starts.length, lines, fail }
}

// 「算搜」名单（照 SEARCH-TOOLS.md 第二节；白名单在第三节）
const SEARCHY = ['session_search', 'session_event_search', 'session_event_read', 'session_event_trace',
  'session_trace', 'session_compaction_list', 'investigate', 'export_prompt']

// 可选：--since <seq> 只看该 seq 之后的事件（「压缩之后那段」的列）；不传 = 全量。
// 可选：--whitelist <子串> 指定「读这些不算搜」的白名单（§8.4 第 6 条：不许硬编码在某一跑上）。
const argv = process.argv.slice(2)
let since = 0
let whitelist = ''
const files = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--since') { since = Number(argv[++i]) || 0 }
  else if (argv[i] === '--whitelist') { whitelist = argv[++i] ?? '' }
  else files.push(argv[i])
}

for (const file of files) {
  const raw = readFileSync(file)
  const types = new Map()
  const tools = new Map()
  const pathsIn = new Map()   // 白名单内的读（我们发的料）—— 不算搜
  const pathsOut = new Map()  // 白名单外的读 —— 按 SEARCH-TOOLS.md 第二节第 6 条，算一次搜
  let sampleKind = null
  let skipped = 0
  const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1)

  const info = decodeFrames(raw, (o) => {
    if (since && (Number(o.seq) || 0) < since) { skipped++; return }
    bump(types, o.type ?? '(none)')
    if (o.type !== 'tool/call') return
    const name = o.data?.name ?? '(unknown)'
    bump(tools, name)
    if (name === 'pwsh') {
      const args = typeof o.data?.arguments === 'string' ? o.data.arguments : JSON.stringify(o.data?.arguments ?? '')
      console.log(`  [pwsh 调用原文] ${args.slice(0, 400)}`)
    }
    if (name === 'read' || name === 'glob' || name === 'grep') {
      const args = typeof o.data?.arguments === 'string' ? o.data.arguments : JSON.stringify(o.data?.arguments ?? '')
      // 白名单：读我们发的料不算搜。`--whitelist <子串>` 指定；未给则退化为「continuity-probe 下的任何路径」
      const ok = whitelist ? args.includes(whitelist) : /continuity-probe/i.test(args)
      bump(ok ? pathsIn : pathsOut, name + ' → ' + args.slice(0, 90))
    }
  })

  const total = [...tools.values()].reduce((a, b) => a + b, 0)
  const searchers = [...tools.entries()].filter(([t]) => SEARCHY.includes(t))
  console.log(`\n===== ${file.split('\\').slice(-2)[0]} =====`)
  console.log(`解码: ${info.frames} 帧 / ${info.lines} 行（解析失败 ${info.fail}）`)
  console.log(`时间窗: ${since ? `seq >= ${since}（窗口内 ${info.lines - skipped} 事件，跳过 ${skipped}）` : '全量（未给 --since）'}`)
  console.log(`工具调用事件总数: ${total}`)
  console.log('按工具计数: ' + ([...tools.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('  ') || '(无)'))
  console.log(`「算搜」名单命中: ${searchers.length ? searchers.map(([k, v]) => `${k}×${v}`).join('  ') : '0 项 ✓'}`)
  console.log(`读白名单（读这些不算搜）: ${whitelist || '(未指定 → 默认 continuity-probe 下的任何路径)'}`)
  console.log(`读白名单内（我们发的料）: ${[...pathsIn.entries()].map(([k, v]) => `${v}×`).join(' ') || '(无)'}`)
  console.log(`读白名单外（**算搜**）: ${pathsOut.size ? [...pathsOut.entries()].map(([k, v]) => `${v}× ${k}`).join(' ｜ ') : '0 次 ✓'}`)
  console.log('样本: ' + (sampleKind ?? '(没抓到 tool 事件)'))
  const interesting = [...types.entries()].filter(([t]) => /tool/i.test(t))
  console.log('带 tool 的事件类型: ' + interesting.map(([k, v]) => `${k}×${v}`).join('  '))
}
