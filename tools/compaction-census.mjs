// compaction-census —— 扫 dsh 会话日志里的压缩事件（连续压缩取证）
// 用法:
//   node compaction-census.mjs show <会话 key 子串>     # 详列该会话每次压缩 + 失败尝试
//   node compaction-census.mjs chain <会话 key 子串>    # 画「摘要被再摘要」的链
//   node compaction-census.mjs list [--scope <workspace 子串>]   # 全库排行；--scope 收成一条线（旧写法 list x <子串> 仍认）
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { decodeAny, sessionFilesUnder, findSessionAny, describeLayouts, LAYOUTS, pairKey, PAIRING_KEY } from './foreign-log-adapter.mjs'

const ROOT = process.env.DSH_SESSIONS_DIR || join(homedir(), '.dsh', 'sessions')
const textOf = (blocks) => (blocks ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')

// 解码（容器 + 事件词表）全在 foreign-log-adapter 的两张表里：换 harness 改表，不改这里。
// 认不出布局 ⇒ decodeAny 抛错（大声失败），不静默跳过文件。
function decodeFile(filePath, onLine) {
  return decodeAny(basename(filePath), readFileSync(filePath), onLine)
}

function findSession(want) {
  return findSessionAny(ROOT, want)
}

const fmt = (t) => t === undefined ? '·' : new Date(t).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
const cmd = process.argv[2] || 'show'
const arg = process.argv[3] || ''
// 可选作用域过滤（按 workspace 名子串，例如 '--C-dev--'）：把「全库」读数收成「这条线的会话」。
// 判据句里的「这条线的会话不再撞上压不缩」需要它 —— 全库计数管不到「这条线」。
// 两种写法都认：`list --scope <子串>`（推荐）与旧位置写法 `list x <子串>`（第三个参数历来是占位符）。
// ⚠️ 2026-09-19：我按直觉写成 `list <子串>`，它**不报错、不过滤**，静默地把全库表当成了「这条线」——
//    所以下面多打印一行：第三个参数被忽略时明说，别让一次静默错误答非所问。
const scopeFlagIdx = process.argv.indexOf('--scope')
const scope = cmd !== 'list' ? ''
  : scopeFlagIdx >= 0 ? (process.argv[scopeFlagIdx + 1] || '')
    : (process.argv[4] || '')
if (cmd === 'list' && scope === '' && arg !== '' && scopeFlagIdx < 0) {
  console.error(`⚠️  第三个参数 "${arg}" 被忽略了 —— list 的过滤要用 --scope <子串>（或旧写法 list x <子串>）；本次是全库。`)
}

if (cmd === 'list') {
  const rows = []
  const files = sessionFilesUnder(ROOT)
  console.log(`布局认了 ${LAYOUTS.length} 种（${describeLayouts()}）；在 ${ROOT} 下找到 ${files.length} 份日志`)
  for (const f of files) {
    const parts = f.rel.split('/')
    const ws = parts[0]
    // 会话 id = 日志文件的**父目录名**（多帧 zstd 时就是会话目录；换布局也不改这个口径）
    const id = parts.length >= 2 ? parts[parts.length - 2] : f.name
    if (scope && !ws.includes(scope)) continue
    const size = statSync(f.path).size
    let n = 0, shadow = 0, fails = 0
    // 记账可能**不在**摘要事件上，而落在与它配对的 receipt 上（第二个 harness 实测就是这个形状）
    // ⇒ 按 `compactionId` 跨记录取一次；取不到就是取不到，不补 0。
    const needShadow = new Set()
    const shadowByReceipt = new Map()
    decodeFile(f.path, (o) => {
      if (o.type === 'compaction/summary') {
        n++
        if (o.data?.shadowedTokenCount !== undefined) shadow += o.data.shadowedTokenCount
        else if (o.data?.compactionId !== undefined) needShadow.add(o.data.compactionId)
      }
      if (o.type === 'compaction/receipt' && o.data?.compactionId !== undefined && o.data?.shadowedTokenCount !== undefined) {
        shadowByReceipt.set(o.data.compactionId, o.data.shadowedTokenCount)
      }
      if (o.type === 'compaction/end' && o.data?.error) fails++
    })
    let fromReceipt = 0
    for (const cid of needShadow) { const v = shadowByReceipt.get(cid); if (v === undefined) continue; fromReceipt++; shadow += v }
    // ⚠️ 这条兜底**对本 harness 永不触发**（compaction/receipt 只有五个字段，见 compaction/src/types.ts:83 与
    //    core/session/src/known-event-shapes.ts:29；token 记在 compaction/summary.shadowedTokenCount）。
    //    它是为第二个 harness 的形状留的——那一刻是**未验证的信念**，所以它一旦真的用到就出声，别静默。
    if (fromReceipt > 0) console.error(`⚠️  ： 次遮蔽量取自 **receipt**（本 harness 不该出现；若出现说明又有一种形状）`)
    if (n > 0 || fails > 0) rows.push({ ws, id, n, fails, shadow, size, mtime: statSync(f.path).mtimeMs })
  }
  rows.sort((a, b) => b.n - a.n)
  if (!rows.length) {
    console.error(`⚠️  0 sessions with compaction events found under: ${ROOT}`)
    console.error('    This is "empty output", NOT "measured zero compactions". Check that DSH_SESSIONS_DIR points at')
    console.error('    your session root (the directory containing */session.jsonl.zstd).')
    process.exit(3)
  }
  console.log(scope ? `压缩次数排行（作用域含 "${scope}"）:` : '压缩次数排行（全库）:')
  for (const r of rows) {
    console.log(`${String(r.n).padStart(3)}×成功 ${String(r.fails).padStart(2)}✗失败  遮蔽 ${String(Math.round(r.shadow / 1000)).padStart(5)}k tok  ${String(Math.round(r.size / 1024)).padStart(6)}KB  ${fmt(r.mtime).padEnd(21)} ${r.ws}/${r.id}`)
  }
  process.exit(0)
}

const target = findSession(arg)
if (!target) { console.error('没找到含 "' + arg + '" 的会话'); process.exit(2) }
const [ws, id, file, raw, size] = target

const summaries = []
const starts = []
const ends = []
const receipts = []
const checkpoints = []   // 压缩产生的替换节点（surface 上的「摘要」本体）
let lastTime = 0
let userMsgs = 0

const stat = decodeAny(basename(file), raw, (o) => {
  lastTime = o.time ?? lastTime
  switch (o.type) {
    case 'compaction/start': starts.push(o); break
    case 'compaction/summary': summaries.push(o); break
    case 'compaction/end': ends.push(o); break
    case 'compaction/receipt': receipts.push(o); break
    case 'user/message': {
      userMsgs++
      const src = o.data?.source
      if (src && src.kind === 'plugin' && src.plugin === 'compact') {
        checkpoints.push({ seq: o.seq, time: o.time, len: textOf(o.data.content).length, op: o.data.surfaceOp, cid: src.compactionId })
      }
      break
    }
  }
})

console.log(`会话 ${ws}\\${id}  ·  ${(size / 1048576).toFixed(1)}MB  ·  ${stat.lines} 行  ·  ${fmt(lastTime)}`)
console.log(`compaction: start=${starts.length} 成功=${summaries.length} end=${ends.length}  ·  checkpoint 节点=${checkpoints.length}  ·  user/message 总数=${userMsgs}  · 解析失败=${stat.fail}`)
console.log(`（遮蔽量前缀 ~ = 该数取自**配对的 receipt**，不在摘要事件上；dsh 的 receipt 三格与其它 harness 的记账形状会在每行末尾写明）\n`)

const receiptByCid = new Map(receipts.map((r) => [r.data?.compactionId, r.data ?? {}]))
// receipt 的展示：dsh 的 receipt 有三格（缺节 / 丢路径 / 丢错误码），**别的 harness 的记账里没有这三格**。
// 打三个 0 会把「这个模型里没有这一栏」读成「这一栏是空的」—— 同一族错误（空 ≠ 零）。
const RECEIPT_TRIPLE = ['missingSections', 'droppedFilePaths', 'droppedErrorCodes']
function receiptNote(rc) {
  const hasTriple = RECEIPT_TRIPLE.some((k) => rc[k] !== undefined)
  if (hasTriple) {
    return `  receipt: 缺节 ${(rc.missingSections ?? []).length} / 丢路径 ${(rc.droppedFilePaths ?? []).length} / 丢错误码 ${(rc.droppedErrorCodes ?? []).length}`
  }
  // 别的 harness 的记账形状：**只印适配器声明为记账的那些字段**（`__accounting`），
  // 不去打印记录信封（uuid / subtype / content…）—— 那些字段存在，但不是这一行在回答的问题。
  const declared = Array.isArray(rc.__accounting) ? rc.__accounting : []
  const shown = declared.filter((k) => rc[k] !== undefined)
  if (!shown.length) return '  receipt（这个 harness 的记账形状）: 适配器未声明记账字段'
  return `  receipt（这个 harness 的记账形状）: ${shown.map((k) => `${k}=${typeof rc[k] === 'number' ? rc[k] : String(rc[k]).slice(0, 24)}`).join(' / ')}`
}
const cpBySeq = new Map(checkpoints.map((c) => [c.seq, c]))
let priorCp = []               // 本次压缩「之前」已存在的 checkpoint 节点
const cpIdx = new Map(checkpoints.map((c, i) => [c.seq, i + 1]))
const rows = []
let carriedSum = 0
let rawSum = 0
for (const [i, s] of summaries.entries()) {
  const d = s.data ?? {}
  const sum = textOf(d.summary)
  const seqs = d.shadowedSeqs ?? []
  const eaten = seqs.filter((q) => cpBySeq.has(q))
  const eatenChars = eaten.reduce((a, q) => a + cpBySeq.get(q).len, 0)
  carriedSum += eatenChars
  rawSum += sum.length
  const rc = receiptByCid.get(d.compactionId)
  // 遮蔽量的来源可能**不在**摘要事件上（第二个 harness 实测：记账落在与它配对的 receipt 上）
  const fromReceipt = d.shadowedTokenCount === undefined && rc?.shadowedTokenCount !== undefined
  const shadowTok = d.shadowedTokenCount ?? rc?.shadowedTokenCount
  rows.push({ i: i + 1, seq: s.seq, time: s.time, token: shadowTok, shadowFromReceipt: fromReceipt, nodes: seqs.length, len: sum.length, eaten, eatenChars, receipt: rc, sum })
  console.log(
    `#${String(i + 1).padStart(2)} ${fmt(s.time)}  遮蔽 ${(fromReceipt ? '~' : ' ') + String(shadowTok ?? 0).padStart(6)} tok/${String(seqs.length).padStart(4)} 节点  ` +
    `摘要 ${String(sum.length).padStart(6)} 字  ` +
    (eaten.length ? `◀ 吃掉旧摘要×${eaten.length}（${eatenChars} 字，来自 #${eaten.map((q) => cpIdx.get(q)).join(',#')}）` : '（全新内容）') +
    (rc ? receiptNote(rc) : '')
  )
}

// 失败尝试
const fails = ends.filter((e) => e.data?.error)
if (fails.length) {
  console.log('\n---- 失败尝试（有 end.error / 或有 start 无 summary）----')
  for (const e of fails) console.log(`  end seq=${e.seq} ${fmt(e.time)} turn=${e.data?.turn} error=${JSON.stringify(e.data?.error).slice(0, 200)}`)
}
// 配对键来自适配器（`compactionId`）：**曾经这里假定 start 与 summary 的 seq 相等**，
// 那个假定在本机真语料上从不成立 ⇒ 这一节曾把每一次 start 都误报成「没产出摘要」（2026-09-19 修）。
const summaryKeys = new Set(summaries.map(pairKey))
const dangling = starts.filter((s) => !summaryKeys.has(pairKey(s)))
if (dangling.length) {
  console.log(`\n---- 触发了 start 但没产出 summary 的 ${dangling.length} 次（配对键 ${PAIRING_KEY}）----`)
  for (const s of dangling) console.log(`  start seq=${s.seq} ${fmt(s.time)} turn=${s.data?.turn} focus=${JSON.stringify(s.data?.focus ?? null).slice(0, 80)}`)
}
// 未闭合的锁（同一配对键的 end 没出现）
const endKeys = new Set(ends.map(pairKey))
const openStarts = starts.filter((s) => !endKeys.has(pairKey(s)))
if (openStarts.length) console.log(`\n⚠ 未闭合的 start: ${openStarts.map((s) => s.seq).join(', ')}`)

const carryNote = rawSum
  ? `其中 ${carriedSum} 字（${(carriedSum / rawSum * 100).toFixed(1)}%）来自「被吃掉的旧摘要」`
  : `「被吃掉」的占比**不适用** —— 摘要正文合计 0 字（这个 harness 的正文不在我们取的那条事件上；不是 0%）`
console.log(`\n总计：${summaries.length} 份摘要共 ${rawSum} 字；${carryNote}`)

if (cmd === 'chain') {
  console.log('\n---- 摘要链：第一份 vs 最后一份（各前 600 字）----')
  console.log('\n[#1]\n' + rows[0].sum.slice(0, 600))
  console.log('\n[#' + rows.length + ']\n' + rows[rows.length - 1].sum.slice(0, 600))
}

const out = join(process.env.TEMP || '.', `compaction-${id}.json`)
writeFileSync(out, JSON.stringify({ ws, id, size, checkpoints, rows, fails: fails.map((e) => e.data), dangling: dangling.map((s) => ({ seq: s.seq, time: s.time, data: s.data })) }, null, 2))
console.log(`\n明细已落盘: ${out}`)
