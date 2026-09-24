# Two Walls, Two Rulers: What Context Compaction Actually Drops in a Real Agent Deployment

**Independent research report · September 2026 · Anan Long**
📄 **[Paper (PDF, 28 pages)](paper/two-walls-two-rulers.pdf)** · LaTeX source + figures in [`paper/`](paper/) · DOI: *pending — assigned on the first Zenodo release*

---

## What this is

Long-horizon agents survive their own context window by **compacting**: a model summarizes the older part of a conversation, the summary replaces what it shadowed, and work continues. This report measures what that step actually drops — not on a benchmark, but on **one real, continuously used single-machine agent deployment**: **48 session directories with at least one successful compaction, 203 successful compactions, and 41 recorded failure attempts** (snapshot 2026-09-19 00:3x local).

Every number is paired with the snapshot it was taken at, because the deployment keeps running. Every device used to produce a number runs on ordinary session logs and is included here.

## Four findings

1. **Failures are three mechanisms, not one.** Truncation (24), *no-shrink* — the summary is not smaller than what it shadows (15), and a token-meter mismatch (2). The first two need **opposite** remedies: one needs an output-budget strategy, the other a criterion for *refusing to compact* that span. A later channel shows the same disagreement on **20 of 231** successful compactions.
2. **Summaries do not carry freshness — structurally, not by accident.** The `Next Step` section is written by the summarizer at generation time and rewritten only by the next compaction; nothing in the summary format carries a timestamp or a validity condition, so an already-resolved state travels as current. The half that carries is behavioural: probes given one real summary moved on that resolved state instead of reporting it.
3. **Two rulers, one phenomenon.** Constraint items survive **13% verbatim** after one compaction round and **0%** by round four, but **91 / 77 / 53%** *semantically* (k = 1, 2, 4) — and the least stable of those points is the one we headline. Readers differ on **one seam** (`verbatim` ↔ `reworded`), never on whether a constraint survived.
4. **The miss replicates; the substitute does not.** Given the material **without** a retrieval card, **12 of 12** probes failed to retrieve the operative constraint and none marked uncertainty; with a card, 4 of 4 did. *Which* constraint they substituted varied across batches.

**We claim no fix.** The report states what we measured, where we measured it, and what would falsify it — see §7 (*What we do not claim*) and §8 (*Limitations*).

## What is in this repository

| Path | What it is |
|---|---|
| `paper/` | The report: PDF, LaTeX source, four figures |
| `tools/` | **19 measurement and build devices** — each prints the criterion it applies, and its thresholds live in the device header rather than in the paper |
| `data/sessions.md` | Aggregate per-session columns, anonymized (`S01`…`S48`) |
| `DATA-POLICY.md` | What is publishable and what is not, and why |

### Running the devices

Node.js 20+ or later; **no third-party packages**. The devices read a session-log store:

```bash
export DSH_SESSIONS_DIR=/path/to/your/sessions     # default: the tool's own ~/.dsh/sessions
node tools/compaction-census.mjs list              # per-session successful / failed compactions
node tools/constraint-survival.mjs                 # verbatim survival curve
node tools/net-shrink.mjs                          # successful compactions that did not shrink
node tools/check-redline.mjs                       # no personal path or identifier leaked into the text
```

Two of the devices ship with a **deliberately broken fixture** so that you can watch a criterion go red rather than take our word for it: `audit-census-invariants.mjs` (four counting invariants) and `fisher.mjs` (a known-answer self-check: 4/4 vs 0/4 must equal `2/C(8,4) = 0.028571`, else it exits 3). The build chain (`build-report.mjs`, `build-tex-en.mjs`, `pack-arxiv.mjs`) additionally needs `pandoc` and a LaTeX installation — it is included because the report's own PDF is produced by it.

`tools/PROTOCOL.md` documents the probe protocol: material/question/key discipline, scoring columns, the search-counting rule and its traps.

## What is deliberately not included

- **Session transcripts and summary texts.** They contain one person's private work and personal context. Under [`DATA-POLICY.md`](DATA-POLICY.md) they are not publishable, regardless of research value. This is also why the survival readings are reported as rates over anonymized cells rather than as quoted passages.
- **The identifier mapping.** `data/sessions.md` uses identifiers ordered by generation count; the mapping to real session identifiers stays local.
- **Anything that identifies the machine or the person.** Devices take paths from environment variables or their own default tool directories; the aggregate table carries counts only. (A literal-string scan for personal paths, session identifiers and contact strings runs as part of the build; its criterion and its blind spot are stated in `tools/check-redline.mjs`.)

## Citing this work

`CITATION.cff` is in the repository root. Until a DOI is assigned:

```bibtex
@misc{long2026twowalls,
  title        = {Two Walls, Two Rulers: What Context Compaction Actually Drops in a Real Agent Deployment},
  author       = {Long, Anan},
  year         = {2026},
  month        = {sep},
  howpublished = {Independent research report},
  note         = {Code and aggregate data: \url{https://github.com/laa1991/two-walls-two-rulers}},
  doi          = {10.5281/zenodo.XXXXXXX}
}
```

## Limitations, stated up front

- **One deployment, one machine, one user.** Every *rate* we report is a rate about this deployment; what we argue transfers is the **taxonomy**, the **device** and the **protocol**, not the rates.
- **The judges are ours.** Thresholds, item splitting and the three-state rule were written by the authors, and the machine judges were instantiated by the same system under study. A human pass exists (one author, blind to the key); a **non-author** annotator does not.
- **The corpus is live.** Anyone re-running a census today will get counts larger than the ones printed here; the report says so and pairs every corpus-level number with its snapshot.

## License

- **Code and devices** (`tools/`): Apache-2.0 — see [`LICENSE`](LICENSE).
- **Report and text** (`paper/`, this README, `DATA-POLICY.md`): CC BY 4.0.
- **Aggregate data** (`data/`): CC BY 4.0.
