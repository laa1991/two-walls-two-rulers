// foreign-log-adapter —— 让普查装置能吃**别的 harness** 的会话日志（可移植性接缝）
//
// 为什么有这个文件：报告 §6 写着「我们的装置可移植性是关于**输入**的主张，未验」。
// 这句话要么被验一次、要么别写。可移植性有两半，缺一半都不算通：
//   ① **容器/布局**：文件叫什么、压没压、一行一条还是多帧 zstd
//   ② **事件词表**：那边把「压缩成功」叫什么事件、字段叫什么名
// 于是这里把两半都做成**一张可改的表**，而不是散在代码里的 if：
//   LAYOUTS      —— 认哪种文件 + 怎么解出「一条一条记录」
//   EVENT_ALIASES / FAILURE_EVENTS / FIELD_ALIASES —— 那边的词 → 普查装置认的词
//
// 用法：`compaction-census.mjs` 只调 `decodeAny(fileName, raw, onLine)`；
// 换一个 harness 时改**这三张表**，不动普查逻辑（判据仍在普查脚本头里）。
//
// ⚠️ 至今只在本机 dsh 的真实日志 + 一份**合成的**外部日志（`make-foreign-fixture.mjs`）上跑过；
//    **真的第二个 harness 的日志我们还没有** —— 这一条别在文里写过头。

import { zstdDecompressSync, gunzipSync } from 'node:zlib'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

// —— ① 布局：认哪种文件、怎么解 ——
export const LAYOUTS = [
  {
    id: 'dsh-multiframe-zstd',
    match: (name) => name === 'session.jsonl.zstd',
    // 多帧 zstd：一个文件里串了 N 个独立 frame，逐帧解、跨帧续行
    decode(raw, onLine) {
      const starts = []
      for (let i = 0; i < raw.length - 3; i++) {
        if (raw[i] === MAGIC[0] && raw[i + 1] === MAGIC[1] && raw[i + 2] === MAGIC[2] && raw[i + 3] === MAGIC[3]) starts.push(i)
      }
      let carry = '', fail = 0, lines = 0
      for (let k = 0; k < starts.length; k++) {
        const end = k + 1 < starts.length ? starts[k + 1] : raw.length
        let text
        try { text = zstdDecompressSync(raw.subarray(starts[k], end)).toString('utf8') } catch { continue }
        const parts = (carry + text).split('\n')
        carry = parts.pop() ?? ''
        for (const p of parts) { if (!p) continue; lines++; try { onLine(JSON.parse(p)) } catch { fail++ } }
      }
      if (carry) { try { onLine(JSON.parse(carry)) } catch { fail++ } }
      return { frames: starts.length, lines, fail }
    },
  },
  {
    id: 'gzip-jsonl',
    match: (name) => name.endsWith('.jsonl.gz'),
    decode(raw, onLine) { return jsonl(gunzipSync(raw).toString('utf8'), onLine) },
  },
  {
    id: 'plain-jsonl',
    match: (name) => name.endsWith('.jsonl'),
    decode(raw, onLine) { return jsonl(raw.toString('utf8'), onLine) },
  },
]

function jsonl(text, onLine) {
  const lines = text.split('\n').filter((p) => p.trim())
  let fail = 0
  const out = []
  for (const p of lines) {
    let o
    try { o = JSON.parse(p) } catch { fail++; continue }
    // 外部记录通常没有 `seq`；用**行号**补一个（装置面靠它显示与配对 —— 它是我们的编号，不是对方的）
    if (o.seq === undefined) o.seq = out.length + 1
    out.push(o)
  }
  for (const o of out) onLine(o)
  return { frames: 1, lines: lines.length, fail }
}

// —— ② 词表：那边怎么说、这边怎么认 ——
export const EVENT_ALIASES = {
  'ctx.compact': 'compaction/start',
  'ctx.compacted': 'compaction/summary',
  'ctx.compact_done': 'compaction/end',
  'ctx.compact_receipt': 'compaction/receipt',
}
export const FAILURE_EVENTS = { 'ctx.compact_failed': 'compaction/end' }   // 失败事件：映射成 end，并把原因塞进 .error

export const FIELD_ALIASES = {
  shadowedTokenCount: ['tokensShadowed', 'tokens_shadowed'],
  shadowedSeqs: ['seqs'],
  compactionId: ['cid'],
}

// —— ②b 谓词型别名：外部 harness 用**布尔标记 / 子类型**表示压缩，而不是用事件名 ——
// 第一条是**真的**（2026-09-19 在第二个 harness 的原生日志上实测定的，不是设想）：
//   Claude Code 的 transcript 里，一次压缩落成两条记录：
//     · `system` + `subtype: 'compact_boundary'`，带 `compactMetadata`
//       （实测字段：`trigger` 字符串 · `preTokens` · `postTokens` · `durationMs` ·
//        `preservedSegment` · `preservedMessages` · `cumulativeDroppedTokens`，各出现 29 次）
//     · `user` + `isCompactSummary: true`，`message.content` 是**字符串**（摘要正文）
//   本步只把**边界**映射成 `compaction/summary`（计数 + 记账）：`shadowedTokenCount` 取
//   `preTokens` —— ⚠️ 那是「压缩前上下文 token 数」，是遮蔽量的**上界**，不是精确值，别当同一把尺用。
//   两条记录配对**实测**成立（29/29）：摘要记录的 `parentUuid` == 边界记录的 `uuid` ⇒ 用 id 配对。
//   ⚠️ `shadowedTokenCount` 取 `preTokens` —— 那是「压缩前上下文 token 数」，是遮蔽量的**上界**，
//      不是同一把尺上的精确值；跨 harness 报这个数时必须带这句限定。
export const PREDICATE_ALIASES = [
  {
    id: 'claude-code/isCompactSummary → 摘要（正文 + 计数）',
    when: (o) => o.type === 'user' && o.isCompactSummary === true,
    to: 'compaction/summary',
    // 配对键**实测**成立（29/29）：摘要记录的 `parentUuid` == 那条边界记录的 `uuid`
    // —— 用 id 配对，不用「相邻」（ERR-047 的教训：位置不是身份）。
    pick: (o) => ({
      compactionId: o.parentUuid,
      summary: [{ type: 'text', text: typeof o.message?.content === 'string' ? o.message.content : '' }],
    }),
  },
  {
    id: 'claude-code/compact_boundary → 记账（receipt）',
    when: (o) => o.type === 'system' && o.subtype === 'compact_boundary',
    to: 'compaction/receipt',
    pick: (o) => {
      const m = o.compactMetadata ?? {}
      return {
        compactionId: o.uuid,                   // 与上面那条的 parentUuid 同一个值 ⇒ 成对
        shadowedTokenCount: m.preTokens,        // ⚠️ 上界：那是「压缩前上下文 token 数」，不是精确遮蔽量
        trigger: m.trigger,
        postTokens: m.postTokens,
        cumulativeDroppedTokens: m.cumulativeDroppedTokens,
        durationMs: m.durationMs,
        // 声明**哪些字段是记账**（不是从记录信封里猜）：census 的 receipt 行只印这些
        __accounting: ['shadowedTokenCount', 'trigger', 'postTokens', 'cumulativeDroppedTokens', 'durationMs'],
      }
    },
  },
]

// 顶层字段别名（外部记录常常没有 `data` 信封，字段就在顶层）
export const RECORD_ALIASES = { time: ['timestamp'] }

/** 把一条外部记录改写成普查装置认的形状；认不出的事件原样返回（`type` 不变 ⇒ 普查自然忽略它）。 */
export function canonicalize(o) {
  if (!o || typeof o !== 'object') return o
  const out = { ...o }
  // 没有 `data` 信封的外部形状：整条记录就是 data（`type`/`seq`/`time` 留在顶层）
  const d = o.data !== undefined
    ? { ...o.data }
    : Object.fromEntries(Object.entries(o).filter(([k]) => !['type', 'seq', 'time', 'timestamp'].includes(k)))
  for (const [canon, alts] of Object.entries(FIELD_ALIASES)) {
    if (d[canon] !== undefined) continue
    for (const a of alts) if (d[a] !== undefined) { d[canon] = d[a]; break }
  }
  for (const [canon, alts] of Object.entries(RECORD_ALIASES)) {
    if (out[canon] !== undefined) continue
    for (const a of alts) if (o[a] !== undefined) { out[canon] = o[a]; break }
  }
  // 摘要正文：那边可能给一个字符串，我们认 [{type:'text', text}]
  if (typeof d.text === 'string' && d.summary === undefined) d.summary = [{ type: 'text', text: d.text }]
  out.data = d
  if (EVENT_ALIASES[o.type]) { out.type = EVENT_ALIASES[o.type] }
  else if (FAILURE_EVENTS[o.type]) {
    out.type = FAILURE_EVENTS[o.type]
    if (out.data.error === undefined) out.data.error = d.reason ?? d.error ?? 'unknown failure'
  } else {
    const p = PREDICATE_ALIASES.find((r) => r.when(out))
    if (p && p.to) { out.type = p.to; out.data = { ...out.data, ...p.pick(out) } }
  }
  return out
}

export function layoutFor(fileName) {
  return LAYOUTS.find((l) => l.match(fileName)) ?? null
}

// —— ③ 配对键：把「同一个压缩的三条事件」串起来的那把钥匙 ——
// 这一条是被**合成 fixture 逼出来的**（2026-09-19）：普查原来假定 start 与 summary **seq 相等**，
// 而在本机真语料上这个假定**从来不成立**（start seq=129373 / summary seq=129374）⇒ 「触发了 start
// 但没产出 summary」那一节把**全部 36 次 start** 都报了，而其中 30 次确实产出了摘要 —— 一个从第一天
// 起就在误报的检测器。真钥匙是 `compactionId`（start / summary / end / receipt 四件都带）。
export const PAIRING_KEY = 'compactionId'

/** 记录 → 配对键。没有 id 的记录退回自己的 seq（必然独一份 ⇒ 与谁都不配，如实计为「配不上」）。 */
export function pairKey(o) {
  const d = o?.data ?? {}
  const v = d[PAIRING_KEY]
  return v !== undefined && v !== null ? `id:${v}` : `seq:${o?.seq}`
}

/** 解一份日志：选布局 → 逐条 canonicalize。认不出布局 ⇒ 抛错（大声失败，不静默跳过）。 */
export function decodeAny(fileName, raw, onLine) {
  const l = layoutFor(fileName)
  if (!l) throw new Error(`no layout matches "${fileName}" (add one to LAYOUTS in foreign-log-adapter.mjs)`)
  return l.decode(raw, (o) => onLine(canonicalize(o)))
}

/** 在 ROOT 下递归找所有「任一布局认得的」日志文件。返回 [{ path, name, rel }]。 */
export function sessionFilesUnder(root, maxDepth = 4) {
  const out = []
  const walk = (dir, depth, rel) => {
    if (depth > maxDepth) return
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { walk(p, depth + 1, rel ? `${rel}/${e.name}` : e.name); continue }
      if (e.isFile() && layoutFor(e.name)) out.push({ path: p, name: e.name, rel: rel ? `${rel}/${e.name}` : e.name })
    }
  }
  walk(root, 1, '')
  return out
}

/** 供 `show` 用：按 key 子串找一个会话（任一布局）。返回 [ws, id, path, raw, size] —— 与旧口径同形。 */
export function findSessionAny(root, want) {
  const hits = sessionFilesUnder(root).filter((f) => f.rel.includes(want))
  if (!hits.length) return null
  const f = hits[0]
  const parts = f.rel.split('/')
  const ws = parts[0]
  const id = parts.length >= 2 ? parts[parts.length - 2] : f.name
  return [ws, id, f.path, readFileSync(f.path), statSync(f.path).size]
}

/** 打印一张「本次认了哪些布局」的表 —— 装置自报口径，别让人以为它只认一种。 */
export function describeLayouts() {
  return LAYOUTS.map((l) => l.id).join(' · ')
}
