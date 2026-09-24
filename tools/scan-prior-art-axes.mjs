#!/usr/bin/env node
// scan-prior-art-axes.mjs — 在「一批 arXiv 全文 HTML」里扫「它们拿什么当比较轴」。
//
// 为什么要有这个装置：本报告的一句主张是「没有人拿**实现**当比较轴」。
// 那是一个**缺席**的主张，而缺席最容易是我自己的扫描器瞎掉造成的假象
// （见 ERR-018 家族：从一个相邻事实推断缺席）。所以这里把三样东西印出来：
//   ① 每个文件里 "across <X>" 的轴词族 —— 证明这个语料里**确实存在**比较轴
//   ② 实现类词（harness / framework / implementation / system）的命中数 —— 本次主张的形式化形状
//   ③ 一条**正对照**（一段我知道一定存在的原文）与一条**负对照**（一段我编的不存在原文）
//      —— 正对照拿不到 ≥1 就 exit 3，免得「扫描器坏了」被读成「没有人做过」
//
// 用法：
//   node scan-prior-art-axes.mjs <dir-of-html>
//   node scan-prior-art-axes.mjs <dir> --positive "across compaction strateg"
//
// 判据（读法）：
//   · 正对照 < 1        ⇒ ⚠️ 扫描器可疑，结论作废（exit 3）
//   · 负对照 > 0        ⇒ ⚠️ 正则在乱匹配，结论作废（exit 3）
//   · 轴词族里只有 model/task/domain/…、而 implementation 一栏为 0 ⇒ 缺席主张成立
//   · 轴词族里出现 "other: …" ⇒ 先把它们逐条读一遍再下结论（那是我可能没预设到的轴）

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) ?? join(process.env.HOME ?? process.env.USERPROFILE ?? '.', 'tmp', 'papers-2609');
const posIdx = args.indexOf('--positive');
const POSITIVE = posIdx >= 0 ? args[posIdx + 1] : 'across compaction strateg';
const NEGATIVE = 'across zzz nothing';

const AXIS_FAMILIES = [
  [/^strateg/i, 'strategy'], [/^model/i, 'model'], [/^task/i, 'task'], [/^domain/i, 'domain'],
  [/^scenario/i, 'scenario'], [/^scale/i, 'scale'], [/^run/i, 'run'], [/^layer/i, 'layer'],
  [/^dataset/i, 'dataset'], [/^corpus|^corpora/i, 'corpus'], [/^seed/i, 'seed'], [/^benchmark/i, 'benchmark'],
  [/^prompt/i, 'prompt'], [/^language/i, 'language'], [/^backbone/i, 'backbone'], [/^session/i, 'session'],
  // ↓ 本次主张关心的那一族：拿「实现」当轴
  [/^(implementation|harness|framework|system|product|tool|cli|vendor|platform|agent)s?$/i, 'IMPLEMENTATION'],
];
const IMPL_WORDS = ['across implementation', 'cross-implementation', 'across harness', 'cross-harness',
  'across framework', 'cross-framework', 'across system', 'across agent frameworks', 'across products',
  'across tools', 'across vendors', 'across platforms'];

function plain(html) {
  return html
    .replace(/<math[\s\S]*?<\/math>/g, ' [M] ')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x2014;/g, '--')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}
const count = (s, p) => (s.match(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) ?? []).length;

const files = readdirSync(dir).filter((f) => f.endsWith('.html')).sort();
if (files.length === 0) {
  console.log(`⚠️ 0 HTML files under ${dir} — nothing scanned, so nothing is claimed (exit 3)`);
  process.exit(3);
}

const corpus = [];
for (const f of files) {
  const p = join(dir, f);
  if (!statSync(p).isFile()) continue;
  corpus.push([f, plain(readFileSync(p, 'utf8'))]);
}

console.log(`dir: ${dir}`);
console.log(`files: ${corpus.length}\n`);

const axisTally = new Map();
let implTotal = 0;
for (const [f, text] of corpus) {
  const axes = new Set();
  const others = new Set();
  const implSpans = [];
  for (const m of text.matchAll(/across (?:the |all |both |three |four |five |seven |eight |multiple |several |different |various )?(?:[A-Za-z][A-Za-z-]* ){0,3}([A-Za-z][A-Za-z-]*)/g)) {
    const head = m[1];
    const fam = AXIS_FAMILIES.find(([re]) => re.test(head));
    if (!fam) { others.add(head.toLowerCase()); continue; }
    axes.add(fam[1]);
    // ⚠️ 这一族**故意松**（含 agent / product 两个高频词做头部），实测会过报：
    //    2605.26302 "across the agent's operational lifetime"、2607.08032 "across collaborating agents"、
    //    2609.11060 "across product attributes" 全是假命中。所以每一处都**逐字印出来**，
    //    让数字不能脱离证据被读走（报数带来源）。收紧后的口径是 IMPL_WORDS（精确短语）。
    if (fam[1] === 'IMPLEMENTATION') implSpans.push(text.slice(Math.max(0, m.index - 150), m.index + 170).trim());
  }
  const implHits = IMPL_WORDS.reduce((n, w) => n + count(text, w), 0);
  implTotal += implHits;
  axes.forEach((a) => axisTally.set(a, (axisTally.get(a) ?? 0) + 1));
  console.log(`${f}  chars=${text.length}  implementation-axis exact-phrase hits=${implHits}  loose-family spans=${implSpans.length}`);
  console.log(`   axes: ${axes.size ? [...axes].join(', ') : '(none matched a known family)'}`);
  for (const s of implSpans) console.log(`   [IMPL?] …${s}…`);
  if (others.size) console.log(`   other-heads (read these before concluding): ${[...others].slice(0, 14).join(', ')}${others.size > 14 ? ` …+${others.size - 14}` : ''}`);
}

console.log('\n— axis families across the corpus (how many papers use it) —');
console.log('   (IMPLEMENTATION is the LOOSE family — known to over-report on the words agent/product; read the [IMPL?] spans)');
for (const [k, v] of [...axisTally.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(16)} ${v}`);

const posHits = corpus.reduce((n, [, t]) => n + count(t, POSITIVE), 0);
const negHits = corpus.reduce((n, [, t]) => n + count(t, NEGATIVE), 0);
console.log(`\nPOSITIVE control "${POSITIVE}" => ${posHits}   (must be >= 1)`);
console.log(`NEGATIVE control "${NEGATIVE}" => ${negHits}   (must be 0)`);
console.log(`IMPLEMENTATION-axis total hits => ${implTotal}`);

if (posHits < 1) { console.log('\n⚠️ positive control missed — the scanner is suspect; do NOT read this as absence (exit 3)'); process.exit(3); }
if (negHits > 0) { console.log('\n⚠️ negative control fired — regex is over-matching; do NOT read this as absence (exit 3)'); process.exit(3); }
console.log('\nOK: scanner alive (positive control hit), no over-match, and the implementation axis is what the tally above says it is.');
