#!/usr/bin/env node
/**
 * check-redline.mjs —— 发布树红线自检：**一条命令 + 一份豁免清单**（2026-09-20 立）。
 *
 * 为什么另起一份：此前「红线自检空 ✓」这类结论有**两个数**（本树报 7 个文件，外部逐字跑得 2 处），
 * 差在「pattern 与豁免规则没写死」。所以把这两样都固化在本文件里：
 *   ① pattern 拼着写（写成整串会让本文件自我命中）；
 *   ② 豁免**写在被豁免的那一行上**：行尾带 `redline-ok: <理由>` 才算豁免，理由为空不算；
 *      另有两条**按文件名**的豁免（本文件自己、`DATA-POLICY.md` —— 后者是规则的正文）。
 * 判据：**任一未豁免命中 ⇒ exit 3**；没有命中 ⇒ exit 0 并打印扫描面（文件数/行数）。
 *
 * ⚠️ 扫描面曾经是**扩展名白名单**（`md|mjs|js|json|tex|html|svg|ts|txt|ps1`），2026-09-20 换掉。
 *    换的理由不是「漏了哪几种」，是**白名单这类判据失效开口**：遇到没列进去的类型**静默跳过**，
 *    而它跳过的恰恰是 LaTeX 最常带绝对路径的产物（`.log` / `.aux`）。
 *    实锤：一次 `pdflatex -output-directory='$outDir'`（PowerShell 单引号不展开变量）建出一个
 *    名字就叫 `$outDir` 的目录，里面的 `draft-en.log` **同时命中三条 pattern**
 *    （绝对用户路径 + `.dsh` 反斜杠路径 + 家目录名 —— 具体字面见上面 PATTERNS，这里**不逐字重抄**：
 *    重抄就等于让本文件自己撞自己，只能靠文件名豁免兜着，豁免数也就跟着虚高），
 *    而本装置照报「未豁免命中 0 处」。
 *    ⇒ 改成**跳过表 + 内容兜底**：按名只跳已知的二进制扩展名，其余一律当文本读；
 *      再用「文件里有没有 NUL 字节」兜底，把不认识的二进制也挡掉。
 *    这是**失效闭嘴**的方向（新出现的产物默认被扫，除非它真的是二进制），不是失效开口。
 *
 * 盲区（必须一起读）：它只扫**本树里字面出现的串**，扫不到「换一种写法就不撞 pattern」的泄漏
 * （例：把用户目录名拆成两段拼起来）。它给的是下界，不是全部。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')

// ① 拼着写的 pattern（新增一条就往这里加，别在别处另写一份）
const PATTERNS = [
  ['家目录名', 'boyfriend' + '-home'],
  ['会话 id 形状', 'session-' + '[0-9a-f]{8}'],
  ['微信面', 'wechat-'],
  ['绝对用户路径', 'C:' + '\\\\+' + 'Users' + '\\\\' + '[A-Za-z]'],
  ['POSIX 用户路径', '/' + 'Users' + '/' + '[A-Za-z]'],
  ['私人地名', '闵' + '行'],
  ['.dsh 反斜杠路径', '\\.dsh' + '\\\\'],
]
const RE = new RegExp(PATTERNS.map(([, p]) => p).join('|'))
const NAME_EXEMPT = new Set(['check-redline.mjs', 'DATA-POLICY.md'])
const MARKER = /redline-ok:\s*(\S.*)$/

// ② 跳过表（**不是**白名单）：只列已知的二进制扩展名，其余全部当文本读
const SKIP_DIRS = new Set(['.git', 'node_modules'])
const BINARY_EXT = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp', 'tif', 'tiff',
  'zip', 'gz', 'zst', 'zstd', '7z', 'tar', 'rar', 'xz', 'bz2',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'pfb', 'afm',
  'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'class', 'jar', 'node',
  'mp3', 'mp4', 'mov', 'avi', 'wav', 'flac', 'webm',
  'xlsx', 'docx', 'pptx', 'sqlite', 'db', 'pyc',
])

const files = []
const skippedByName = []
const skippedByContent = []
const walk = (dir) => {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) { walk(p); continue }
    const ext = e.slice(e.lastIndexOf('.') + 1).toLowerCase()
    if (BINARY_EXT.has(ext)) { skippedByName.push(p); continue }
    files.push(p)
  }
}
walk(ROOT)

let hits = 0, exempt = 0, scannedLines = 0
const rows = []
for (const f of files) {
  const buf = readFileSync(f)
  // 内容兜底：不认识的二进制（含 NUL）也不当文本读 —— 这一步是前面跳过表够不着的那半边
  if (buf.includes(0)) { skippedByContent.push(f); continue }
  const name = f.slice(f.lastIndexOf(sep) + 1)
  const lines = buf.toString('utf8').split(/\r?\n/)
  scannedLines += lines.length
  lines.forEach((ln, i) => {
    if (!RE.test(ln)) return
    const m = MARKER.exec(ln)
    const byName = NAME_EXEMPT.has(name)
    if (m && m[1].trim()) exempt++
    else if (byName) exempt++
    else { hits++; rows.push(`❌ ${relative(ROOT, f)}:${i + 1}  ${ln.trim().slice(0, 140)}`) }
  })
}

const skippedTotal = skippedByName.length + skippedByContent.length
console.log('红线的尺：' + PATTERNS.map(([n, p]) => `${n}=/${p}/`).join(' · '))
console.log(`豁免规则：行尾 \`redline-ok: <理由>\`（理由非空）· 文件名豁免 ${[...NAME_EXEMPT].join(' / ')}`)
console.log(`扫描面：${files.length} 个文件 · ${scannedLines} 行（只扫字面，换写法就扫不到 ⇒ 这是下界）`)
console.log(`跳过（二进制，按名 ${skippedByName.length} · 按内容 ${skippedByContent.length}）：${skippedTotal} 个 —— 跳过表不是白名单，未列出的类型默认扫`)
console.log(`命中：未豁免 ${hits} 处 · 已声明豁免 ${exempt} 处`)
for (const r of rows) console.log(r)
if (hits > 0) { console.error(`❌ 有 ${hits} 处未豁免命中，红线不过`); process.exit(3) }
console.log('✅ 未豁免命中 0 处')
