// make-foreign-fixture —— 造**合成的「别人的 harness」日志**，两份，用途不同：
//
//   clean/   —— 可移植性验收件：让 `compaction-census.mjs` 在**另一种容器 + 另一种事件词表**
//              上真跑一次，把报告里那句「可移植性是未验主张」变成「接缝验过一次，真外部日志仍缺」。
//   decoys/  —— 不变量审计件（`audit-census-invariants.mjs`）的**正对照**：故意违反它的每一条，
//              用来证明那个审计器不是恒绿。一份只会说 ✅ 的审计器，与 ERR-047 那个恒触发的
//              检测器是同一个毛病的两面。
//
// 合成件故意在两半上都和 dsh 不一样：
//   容器：`records.jsonl`（纯文本一行一条）与 `records.jsonl.gz`
//   词表：`ctx.compact` / `ctx.compacted` / `ctx.compact_done` / `ctx.compact_receipt` / `ctx.compact_failed`
//   字段：`tokensShadowed`（不是 shadowedTokenCount）· `seqs` · `cid` · `text`（字符串，不是 blocks 数组）
//
// 用法：node make-foreign-fixture.mjs [outDir]      # 默认 %TEMP%/foreign-harness-fixture
// 跑完它自己印 EXPECT —— 那些就是装置输出必须对上的数（对不上就是装置或这份 fixture 有问题）。

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const out = process.argv[2] || join(tmpdir(), 'foreign-harness-fixture')
rmSync(out, { recursive: true, force: true })

const T = (i) => `2026-09-19T0${i}:00:00.000Z`          // 固定时刻，别让 fixture 自己漂
const summaryText = (n) => `[summary #${n}] task state … boundaries … (synthetic, no real content)`

// ————— clean：普查验收 + 一条「长得像但不该被算进去」的负对照 —————
const sessionA = []
let seq = 1
const push = (o) => sessionA.push(JSON.stringify({ seq: seq++, time: T(1), ...o }))

push({ type: 'user/message', data: { content: [{ type: 'text', text: 'start' }] } })
// 负对照（对「按形状抓」的成员资格判据）：另一个插件发的、内容**长得像摘要**的一条
// ⇒ 期望它**不**被算成 checkpoint（判据是 `source.plugin`，不是内容形状）
push({ type: 'user/message', data: { content: [{ type: 'text', text: summaryText('look-alike from another plugin') }], source: { kind: 'plugin', plugin: 'todo' } } })
for (let n = 1; n <= 3; n++) {
  push({ type: 'ctx.compact', data: { turn: 2 * n, cid: `c${n}`, focus: `round ${n}` } })        // → compaction/start（带 cid = 配对键）
  push({ type: 'ctx.compacted', data: { cid: `c${n}`, tokensShadowed: 4000 * n, seqs: [10, 11], text: summaryText(n) } })  // → compaction/summary
  push({ type: 'ctx.compact_receipt', data: { cid: `c${n}`, missingSections: [], droppedFilePaths: [`a/b${n}.ts`], droppedErrorCodes: [] } })
  push({ type: 'ctx.compact_done', data: { turn: 2 * n, cid: `c${n}` } })                          // → compaction/end
}
push({ type: 'ctx.compact_failed', data: { turn: 99, cid: 'c-fail', reason: 'summary is not smaller than the shadowed content (4389 >= 3952)' } })  // → compaction/end + error
push({ type: 'ctx.something_else', data: { ignored: true } })                                      // 认不出的事件必须被静默忽略（不是崩）

const sessionB = []
let seqB = 1
const pushB = (o) => sessionB.push(JSON.stringify({ seq: seqB++, time: T(2), ...o }))
pushB({ type: 'ctx.compacted', data: { cid: 'b1', tokensShadowed: 2500, seqs: [1], text: summaryText('B1') } })
pushB({ type: 'ctx.compact_done', data: { turn: 1 } })

// ————— decoys：故意违反审计器的每一条不变量（正对照）—————
const decoy = []
let seqD = 1
const pushD = (o) => decoy.push(JSON.stringify({ seq: seqD++, time: T(3), ...o }))
pushD({ type: 'ctx.compact', data: { turn: 1, cid: 'd1' } })                                        // 正常的一条
pushD({ type: 'ctx.compacted', data: { cid: 'd1', tokensShadowed: 1000, seqs: [1], text: summaryText('D1') } })
// ① 同一个 cid 两份摘要（重试形状）⇒ 触发「一次压缩只产出一份摘要」
pushD({ type: 'ctx.compacted', data: { cid: 'd1', tokensShadowed: 1000, seqs: [2], text: summaryText('D1-retry') } })
// ② 一份摘要**没有**遮蔽 token ⇒ 触发「每份摘要都带遮蔽 token」
pushD({ type: 'ctx.compacted', data: { cid: 'd2', seqs: [3], text: summaryText('D2') } })
// ③ 一个 start **没有**配对键 ⇒ 触发「每个 start 都带配对键」
pushD({ type: 'ctx.compact', data: { turn: 2, focus: 'no id' } })

const dirs = {
  a: join(out, 'foreign-ws-alpha', 'session-001'),
  b: join(out, 'foreign-ws-alpha', 'session-002'),
  d: join(out, 'foreign-ws-beta', 'session-003-decoys'),
}
for (const p of Object.values(dirs)) mkdirSync(p, { recursive: true })
writeFileSync(join(dirs.a, 'records.jsonl'), sessionA.join('\n') + '\n', 'utf8')
writeFileSync(join(dirs.b, 'records.jsonl.gz'), gzipSync(Buffer.from(sessionB.join('\n') + '\n', 'utf8')))
writeFileSync(join(dirs.d, 'records.jsonl'), decoy.join('\n') + '\n', 'utf8')

console.log(`fixture written: ${out}`)
console.log(`  foreign-ws-alpha/session-001/records.jsonl          (${sessionA.length} records, plain)`)
console.log(`  foreign-ws-alpha/session-002/records.jsonl.gz       (${sessionB.length} records, gzip)`)
console.log(`  foreign-ws-beta/session-003-decoys/records.jsonl    (${decoy.length} records, plain, DELIBERATELY BROKEN)`)
console.log('')
console.log(`EXPECT census.list --scope foreign-ws-alpha (clean): rows=2  successes=4  failures=1  shadowed_tokens=${4000 + 8000 + 12000 + 2500}`)
console.log(`EXPECT census.list (whole fixture): rows=3  successes=6  failures=1  shadowed_tokens=${4000 + 8000 + 12000 + 2500 + 1000 + 1000}`)
console.log(`EXPECT census.show(session-001): start=3 成功=3 end=4 失败尝试=1 · checkpoint 节点=0 · user/message=2`)
console.log(`      （checkpoint=0 是那条「别的插件的仿冒品」的负对照：它**不该**被算进去）`)
console.log(`EXPECT audit(<out>/foreign-ws-alpha) = exit 0（clean 全绿）`)
console.log(`EXPECT audit(<out>) = exit 3，且恰好 3 条不变量被违反（dupSummaryPerId / missingShadowTokens / startWithoutKey）`)
