#!/usr/bin/env node
/**
 * Fisher 精确检验（双侧）—— Finding 4 那个 p 值的**可重跑**出口。
 *
 * 为什么单独一件：正文写着 `p = 0.029`，而「p 从哪来」原来只活在一次对话里。
 * 判据要能被陌生人重跑 ⇒ 20 行、只吃一个 2×2 表、无依赖。
 *
 * 口径（写死在这里，别口头传）：
 *   - **双侧**定义 = 「概率 ≤ 观测表概率」的所有更极端表之和（R 的 `fisher.test` 同口径）。
 *   - 表按 [[a,b],[c,d]]，行 = 臂，列 = 命中/未命中；a+c = 臂 1 的 n。
 *
 * 用法：
 *   node fisher.mjs                → 打四行：去卡臂为 0/1/2/3 时的双侧 p（含正文用的那格）
 *   node fisher.mjs 4 0 1 3        → 指定表
 *
 * 自检（**已知答案**，先于任何报数）：
 *   4/4 vs 0/4 必须是 2 / C(8,4) = 2/70 = 0.0285714…（四条全对 vs 四条全错，
 *   只有「臂完全分开」这一种排法算极端 ⇒ 双侧 = 2×1/70）。
 *   不合格 ⇒ exit 3，不许报数。
 */

const logC = (n, k) => { let r = 0; for (let i = 1; i <= k; i++) r += Math.log(n - k + i) - Math.log(i); return r }
const choose = (n, k) => Math.exp(logC(n, k))

/** 双侧 Fisher：加总所有「概率 ≤ 观测表概率」的表（固定边缘）。 */
export function fisherTwoSided(a, b, c, d) {
  const r1 = a + b, r2 = c + d, c1 = a + c, n = a + b + c + d
  const p = (x) => choose(r1, x) * choose(r2, c1 - x) / choose(n, c1)
  const pObs = p(a)
  const lo = Math.max(0, c1 - r2), hi = Math.min(r1, c1)
  let sum = 0
  for (let x = lo; x <= hi; x++) if (p(x) <= pObs * (1 + 1e-9)) sum += p(x)
  return Math.min(1, sum)
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, '/') || process.argv[1].endsWith('fisher.mjs')) {
  const expect = 2 / choose(8, 4)
  const got = fisherTwoSided(4, 0, 0, 4)
  console.log(`自检：4/4 vs 0/4 应为 2/C(8,4) = ${expect.toFixed(6)} ⇒ 实为 ${got.toFixed(6)} ⇒ ${Math.abs(got - expect) < 1e-9 ? '✓ 通过' : '✗ 不合格'}`)
  if (Math.abs(got - expect) >= 1e-9) process.exit(3)

  const argv = process.argv.slice(2)
  if (argv.length === 4) {
    const [a, b, c, d] = argv.map(Number)
    console.log(`\n表 [[${a},${b}],[${c},${d}]] ⇒ 双侧 p = ${fisherTwoSided(a, b, c, d).toFixed(4)}`)
  } else {
    console.log('\n含卡 4/4 固定，去卡臂逐格变动（正文用第 1 行）：')
    for (const hit of [0, 1, 2, 3]) {
      const p = fisherTwoSided(4, 0, hit, 4 - hit)
      console.log(`  含卡 4/4 ↔ 去卡 ${hit}/4  ⇒ 双侧 p = ${p.toFixed(4)}${hit === 0 ? '   ← 实测（Finding 4）' : ''}`)
    }
    console.log('\n⇒ 效力全押在那一格 0 上：去卡臂只要有一支选对，p 就从 0.029 掉到 0.14（不再是显著）。')
  }
}
