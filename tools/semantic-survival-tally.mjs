#!/usr/bin/env node
/**
 * semantic-survival-tally.mjs —— 汇总「约束的语义存活」判读（外部尺第二片）。
 *
 * 输入：<SURVIVAL_DIR>/answers/*.md（默认 ~/.dsh/survival，可用 SURVIVAL_DIR 覆盖）
 *       每行形如 `B1 3 | 原样 | <依据>`（允许行首有 `#`、空格）
 * 输出：按 k（压缩轮数）分列的三态计数 —— 合并口径 + 逐会话；
 *       并给出**可与 Cliff 对照的那一列**：`原样 + 改措辞但还在` = 「意思还在」
 *       （Cliff 的 safety-rule recall 是语义口径 ⇒ 只有这一列能与他并排）
 *
 * 用法: node semantic-survival-tally.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const HOME = process.env.USERPROFILE || '.'
const DIR = join(process.env.SURVIVAL_DIR || join(homedir(), '.dsh', 'survival'), 'answers')
const STATES = ['原样', '改措辞但还在', '没了']

const files = readdirSync(DIR).filter((f) => f.endsWith('.md'))
const perSession = []
for (const f of files) {
  const text = readFileSync(join(DIR, f), 'utf8')
  const hits = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*#*\s*B(\d+)\s+(\d+)\s*\|\s*(原样|改措辞但还在|没了)\s*\|(.*)$/)
    if (m) hits.push({ k: Number(m[1]), id: Number(m[2]), state: m[3], ev: m[4].trim() })
  }
  if (!hits.length) { perSession.push({ name: f, hits: [], ok: false }); continue }
  const byK = {}
  for (const h of hits) {
    byK[h.k] = byK[h.k] || { 原样: 0, 改措辞但还在: 0, 没了: 0, ids: new Set() }
    byK[h.k][h.state]++
    byK[h.k].ids.add(h.id)
  }
  perSession.push({ name: f, hits, byK, ok: true })
}

// 文件名由本装置自己生成（`<会话代号>.md`），**不含任何真实标识**；这里只做长度截断。
const compact = (name) => name.replace(/\.md$/, '').slice(0, 40)
console.log('每会话（k = 压缩轮数；括号内为条目数）')
for (const s of perSession) {
  if (!s.ok) { console.log('  ' + compact(s.name).padEnd(42), 'NO PARSED LINES'); continue }
  const parts = Object.keys(s.byK).sort((a, b) => a - b).map((k) => {
    const c = s.byK[k]
    return 'k' + k + ': 原样' + c['原样'] + '/改' + c['改措辞但还在'] + '/没' + c['没了'] + '(' + c.ids.size + ')'
  })
  console.log('  ' + compact(s.name).padEnd(42), parts.join('  '))
}

console.log('\n合并口径（POOLED：把所有会话的条目加在一起）')
const ks = [...new Set(perSession.flatMap((s) => Object.keys(s.byK || {}).map(Number)))].sort((a, b) => a - b)
for (const k of ks) {
  const c = { 原样: 0, 改措辞但还在: 0, 没了: 0 }
  for (const s of perSession) if (s.byK && s.byK[k]) for (const st of STATES) c[st] += s.byK[k][st]
  const tot = c['原样'] + c['改措辞但还在'] + c['没了']
  const alive = c['原样'] + c['改措辞但还在']
  console.log(
    'k=' + k, 'n=' + tot,
    '| 原样', c['原样'], '| 改措辞但还在', c['改措辞但还在'], '| 没了', c['没了'],
    '| **意思还在 = ' + alive + '/' + tot + ' (' + ((alive / tot) * 100).toFixed(0) + '%)**'
  )
}
const out = join(process.env.SURVIVAL_DIR || join(homedir(), '.dsh', 'survival'), 'tally.json')
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), perSession, ks }, null, 2), 'utf8')
console.log('\nWROTE', out)
