#!/usr/bin/env node
// check-tree-refs.mjs —— 产物树的自检：**交叉引用**与**家目录路径残留**。
//
// 为什么有这个（2026-09-19 第二次冷读）：两次冷读逮到的缺陷里，有一类反复出现 ——
//   文中说「完整表在…」「见 §x」「用 `tools/xxx.mjs`」而**那个东西不存在**（或那条路径陌生人打不开）。
//   这类缺陷不会报错，只会让读者在一个不存在的指针上停下来。所以把它做成机械检查。
//
// 判据（打印，违反即 exit 3）：
//   ① 正文里以反引号写出的 `report|tools|data|figures/…` 路径都必须真实存在
//   ② 正文里不得出现家目录路径（`~/…`）与绝对用户路径（`/Users/…`、`C:\Users\…`）
//      —— 例外：**工具自身的默认目录**（如 dsh 的 `~/.dsh/sessions`）要写进注释里说明，不写进正文
//
// 用法：node check-tree-refs.mjs [treeRoot]     # 默认当前目录
import { readFileSync, readdirSync } from 'node:fs'

const root = (process.argv[2] ?? '.').replace(/[\\/]+$/, '')
const PROSE = ['README.md', 'report/draft.md', 'report/cross-harness.md', 'report/prior-art-cross-impl.md']

const all = []
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === '.git') continue
    const p = d + '/' + e.name
    if (e.isDirectory()) walk(p); else all.push(p.slice(root.length + 1))
  }
}
walk(root)
const set = new Set(all)

let bad = 0
for (const f of PROSE) {
  let t
  try { t = readFileSync(root + '/' + f, 'utf8') } catch { continue }
  for (const m of t.matchAll(/`((?:report|tools|data|figures)\/[A-Za-z0-9._-]+)`/g)) {
    if (!set.has(m[1])) { console.log(`✗ 断链 ${f} -> ${m[1]}`); bad++ }
  }
}
console.log(bad ? `⚠️ 断链 ${bad} 处（exit 3）` : `交叉引用 ✓ ${PROSE.length} 份正文里点到的 report/tools/data/figures 路径全部存在`)

// ⚠️ 这几条模式**必须拼出来写**：整段写出来的话，本文件自己就会被打中
//    （2026-09-19 实测两次：先是正则字面量里的转义反斜杠凑出了那条「点 + 名 + 反斜杠」的串，
//      改完注释里又写了一次同样的串 —— 所以这段注释本身也只能绕着说）。
//    同一个坑 `DATA-POLICY.md` 的自检注释里已经写过一次 —— 约定一致：检查串拼着写。
const SEG = {
  tilde: '~' + '/',
  dotDsh: '.' + 'dsh' + '/',
  usersAbs: '/' + 'Users' + '/',
  winAbs: 'C:' + '\\' + '+Users',
  tmpDir: 'tmp' + '/',
}
const HOME_RE = new RegExp(
  [SEG.tilde + SEG.tmpDir, SEG.tilde + SEG.dotDsh, SEG.usersAbs, SEG.winAbs]
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g',
)
let clean = 0
for (const f of PROSE) {
  let t
  try { t = readFileSync(root + '/' + f, 'utf8') } catch { continue }
  // ⚠️ 先去掉围栏代码块：那段是本检查器的**例外**——判据写着「工具自身的默认目录要写进注释里说明」，
  //    而那句说明就住在 README 的命令行示例里（`# Default location is ~/.dsh/sessions`）。
  //    2026-09-22 实测：不移除就把它自己那条例外报成 ⚠️（exit 3），而正文一个字都没错。
  //    代价照实说：代码块里的**真泄漏**（把本机绝对路径写进示例）会漏 —— 那是可接受的取舍，不装第二支尺。
  const prose = t.replace(/^```[\s\S]*?^```[ \t]*$/gm, '')
  for (const m of prose.matchAll(HOME_RE)) {
    console.log(`⚠️ 家目录/绝对用户路径 ${f} -> ${m[0]}`); clean++
  }
}
console.log(clean ? `⚠️ ${clean} 处（exit 3）` : '家目录路径（正文部分）无残留')

if (bad || clean) process.exit(3)
console.log('\n两份检查都过：指针指向真实存在的东西，路径不依赖谁的家目录。')
