#!/usr/bin/env node
/**
 * constraint-survival-pack.mjs —— 为「约束的语义存活」装料（外部尺第二片）。
 *
 * 与第一片（constraint-survival.mjs，逐字口径）**共用同一批 dump、同一套条目抽取**，
 * 只换判据：第一片问「逐字还在不在」，这一片问「**意思**还在不在」（三态）。
 *
 * 用法: node constraint-survival-pack.mjs
 * 读: %TEMP%\compaction-*.json（rows>=3 且有 `## Boundaries` 段）
 * 写: <SURVIVAL_DIR>/<session>.md   （每会话一份，自包含；默认 ~/.dsh/survival，可用环境变量 SURVIVAL_DIR 覆盖）
 *     <SURVIVAL_DIR>/INDEX.md       （清单 + 判分规则）
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const TMP = process.env.TEMP || '.'
const OUT = process.env.SURVIVAL_DIR || join(homedir(), '.dsh', 'survival')
mkdirSync(OUT, { recursive: true })

const KS = [1, 2, 4] // 压缩轮数（与 Cliff 的「一轮后 / 五轮后」同形；我们取 1/2/4，因为逐字口径第 4 代已全灭）

function boundaries(text) {
  const m = text.match(/^## Boundaries\s*$/m)
  if (!m) return null
  const rest = text.slice(m.index + m[0].length)
  const next = rest.match(/^## /m)
  const body = next ? rest.slice(0, next.index) : rest
  return body
    .split(/\r?\n/)
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
    .filter((l) => l.length >= 8)
}

const files = readdirSync(TMP).filter((f) => f.startsWith('compaction-') && f.endsWith('.json'))
const made = []
for (const f of files) {
  let J
  try { J = JSON.parse(readFileSync(join(TMP, f), 'utf8')) } catch { continue }
  const gens = (J.rows || []).map((r) => r.sum).filter((s) => typeof s === 'string' && s.trim())
  if (gens.length < 3) continue
  const b1 = boundaries(gens[0])
  if (!b1 || !b1.length) continue
  const name = f.replace('compaction-', '').replace('.json', '')
  const checks = KS.filter((k) => k <= gens.length - 1)
  let md = '# 判据：约束的「意思」还在不在（零历史窗口作答）\n\n'
  md += '下面有**两样东西**：**A. 第 1 代摘要里列出的约束清单**（编号，来自真实部署会话的第一次压缩）；**B. 这个会话后来的某一代摘要全文**。\n'
  md += '你的任务：对每一条约束，判断它在 B 那一代里**意思还在不在**，三态之一：\n\n'
  md += '- `原样` —— 原句或几乎原句仍能在这份摘要里找到（用词基本未变）\n'
  md += '- `改措辞但还在` —— 用词明显变了（换语言 / 重写 / 挪到别的节），但**它表达的意思仍然在**，照它做事不会做错\n'
  md += '- `没了` —— 这一代摘要里找不到这条约束的意思\n\n'
  md += '规则：**只依据 B 的正文**，不许推测、不许凭常识补全；找不到就写 `没了`。每条给一行：`编号 | 三态 | 依据（引 B 里的原句片段，或写「B 里无对应」）`。\n\n'
  md += '## A. 第 1 代的约束清单\n\n'
  b1.forEach((b, i) => { md += (i + 1) + '. ' + b + '\n' })
  for (const k of checks) {
    md += '\n---\n\n## B' + k + '. 第 ' + (k + 1) + ' 代摘要全文（即「压缩 ' + k + ' 轮之后」的状态）\n\n```\n' + gens[k] + '\n```\n'
  }
  md += '\n---\n\n## 输出格式（照抄这个形状，每条一行）\n\n'
  for (let i = 1; i <= b1.length; i++) md += 'B1 ' + i + ' | <原样|改措辞但还在|没了> | <依据>\n'
  writeFileSync(join(OUT, name + '.md'), md, 'utf8')
  made.push({ name, bullets: b1.length, gens: gens.length, checks, chars: md.length })
}

let idx = '# 外部尺第二片 · 装料清单（约束的语义存活）\n\n'
idx += '生成：constraint-survival-pack.mjs（与第一片同 dump、同条目抽取，只换判据）\n\n'
idx += '| 会话 | 第 1 代约束条数 | 总代数 | 判哪几轮 | 材料字符 |\n|---|---|---|---|---|\n'
for (const m of made) idx += '| ' + m.name + ' | ' + m.bullets + ' | ' + m.gens + ' | ' + m.checks.join(',') + ' | ' + m.chars + ' |\n'
idx += '\n合计：' + made.length + ' 条会话 / ' + made.reduce((a, m) => a + m.bullets, 0) + ' 条约束\n'
writeFileSync(join(OUT, 'INDEX.md'), idx, 'utf8')
console.log(idx)
console.log('WROTE', OUT)
