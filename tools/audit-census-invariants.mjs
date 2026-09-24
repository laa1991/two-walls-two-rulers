// audit-census-invariants —— 把普查**默认成立、但从没被检查过**的假设，拿到语料上真查一遍。
//
// 为什么有这个文件（2026-09-19，同 ERR-047 那一天）：
//   ERR-047 的教训不是「配对键选错了」，而是**一个恒真的判据会长成一条看起来像发现的清单**。
//   普查里还有几处同一形状的假设 —— 它们不写在判据里，而是写在**计数方式**里：
//     · 一次压缩产出**一份**摘要（否则「成功 N 次」会把重试也算成两次）
//     · 一份摘要**都带** shadowedTokenCount（否则遮蔽总量会静默少算）
//     · 一个 checkpoint 节点对应**一个** seq（否则「吃掉旧摘要」的分子会重复计）
//     · 每个 start 都带配对键（否则「配不上」的计数会虚高 —— ERR-047 正是这一条）
//   这些假设谁都没验过。这个装置就是它们的**负对照套件**：语料不满足哪条，就红哪条。
//
// 判据（每条各自独立，全部打印）：违反 ⇒ 列证据并 **exit 3**；全部成立 ⇒ exit 0。
// ⚠️ 已知耦合：checkpoint 的判定条件与 `compaction-census.mjs` 里那一处**逐字相同**
//    （`source.kind==='plugin' && source.plugin==='compact'`）—— 改一处必须改另一处，
//    这是两个文件共用的判据，不是两套判据。
//
// 用法：node audit-census-invariants.mjs [sessionRoot]
// ⚠️ 成本：它要把每份日志**整份读进来** —— 本机全库（365 份、最大几十 MB）约 2–3 分钟，
//    超过默认的 120s 命令预算。想快就**指一个子目录**（工作区那一层）而不是根目录。

import { readFileSync, statSync } from 'node:fs'
import { decodeAny, sessionFilesUnder } from './foreign-log-adapter.mjs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.argv[2] || process.env.DSH_SESSIONS_DIR || join(homedir(), '.dsh', 'sessions')

const violations = { dupSummaryPerId: [], missingShadowTokens: [], dupCheckpointSeq: [], startWithoutKey: [] }
let files = 0, summaries = 0, starts = 0, checkpoints = 0, filesSkipped = 0

for (const f of sessionFilesUnder(ROOT)) {
  let st
  try { st = statSync(f.path) } catch { continue }
  if (!st.isFile()) continue
  files++
  const byId = new Map()
  const cpSeqs = new Map()
  try {
    decodeAny(f.name, readFileSync(f.path), (o) => {
      if (o.type === 'compaction/summary') {
        summaries++
        const id = o.data?.compactionId
        if (id !== undefined) byId.set(id, (byId.get(id) ?? 0) + 1)
        if (o.data?.shadowedTokenCount === undefined) violations.missingShadowTokens.push(`${f.rel}#${o.seq}`)
      }
      if (o.type === 'compaction/start') {
        starts++
        if (o.data?.compactionId === undefined) violations.startWithoutKey.push(`${f.rel}#${o.seq}`)
      }
      if (o.type === 'user/message') {
        const src = o.data?.source
        if (src && src.kind === 'plugin' && src.plugin === 'compact') {
          checkpoints++
          cpSeqs.set(o.seq, (cpSeqs.get(o.seq) ?? 0) + 1)
        }
      }
    })
  } catch { filesSkipped++; continue }
  for (const [id, n] of byId) if (n > 1) violations.dupSummaryPerId.push(`${f.rel} id=${id} ×${n}`)
  for (const [seq, n] of cpSeqs) if (n > 1) violations.dupCheckpointSeq.push(`${f.rel} seq=${seq} ×${n}`)
}

console.log(`root: ${ROOT}`)
console.log(`files=${files}${filesSkipped ? ` (skipped ${filesSkipped})` : ''}  summaries=${summaries}  starts=${starts}  checkpoints=${checkpoints}\n`)

const rows = [
  ['一次压缩只产出一份摘要（否则成功数虚高）', violations.dupSummaryPerId],
  ['每份摘要都带遮蔽 token（否则遮蔽总量静默少算）', violations.missingShadowTokens],
  ['checkpoint 的 seq 唯一（否则「吃掉旧摘要」重复计）', violations.dupCheckpointSeq],
  ['每个 start 都带配对键（ERR-047 的反面）', violations.startWithoutKey],
]
let bad = 0
for (const [name, v] of rows) {
  const mark = v.length === 0 ? '✅' : '❌'
  if (v.length) bad++
  console.log(`${mark} ${name} — 违反 ${v.length}`)
  for (const e of v.slice(0, 5)) console.log(`     ${e}`)
  if (v.length > 5) console.log(`     …另有 ${v.length - 5} 处`)
}
if (bad) { console.log(`\n⚠️ ${bad}/${rows.length} 条不变量被违反 —— 普查的相关计数要么修、要么在文里标注（exit 3）`); process.exit(3) }
console.log(`\n全部 ${rows.length} 条不变量成立。（这只说明普查的计数方式在这份语料上安全，不说明计数正确。）`)
