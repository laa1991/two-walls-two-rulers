# Protocol: continuity probes

> This file describes the **method** behind the numbers in `../report/draft.md` §4–§5.
> It is the publishable distillation of an internal device manual that also carried our own run history; the run artifacts themselves (packs, raw verdicts, logs) stay inside the deployment and are available for the second-annotator pass.

## 0. The question

After a context compaction, does the next window still act on what the previous one knew — **and does it do so without searching for it**? These are two different questions, and both must be measured.

## 1. The criterion has two halves

Stated as one sentence for the whole line: *continuity without searching*. That decomposes into:

1. **Content**: given the material a fresh window would have, can it recover the operative facts (which constraints govern, what is being waited on)?
2. **Behavior**: does its *next action* respect those facts — and does it get there **without searching**?

A run that only measures (1) can report success while (2) fails. Prior work supports treating them separately: agent-critical information can be resident in context rather than persistent, and re-surfacing it does not automatically restore task success.

## 2. One run = material + question + key

- **Material** (`material.txt`): exactly what the window would see — nothing more. Assembled from the real artifacts (a real summary from the deployment, or a real summary plus a retrieval card).
- **Question**: either content questions (choose/select) or a **task** (produce an output file, e.g. a `next` pointer plus a reason). Task form is preferred: it exercises behavior, and its output is checkable.
- **Key**: frozen **before** the run, in the run directory. Two rulers are better than one: keep the original key and add a *wider* key alongside it if you discover the original was too narrow; never edit the frozen one.
- **Probes**: zero-history agents. Each receives its own pack, must read only that pack, and must not search anything (stated in the prompt; verified from its own log, see §5).

## 3. Scoring columns (never a single total)

| Column | Meaning |
|---|---|
| score | primary criterion for that run |
| toxicity | confidently wrong content (worse than an acknowledged gap) |
| **`[guess]`** | whether the probe marked its answer as a guess |

The `[guess]` column is the discriminating one in practice: a probe that recovers the fact by *quoting the material* and a probe that reconstructs it *by inference* can tie on score while differing completely on whether the fact was **carried** or **inferred**.

## 4. Three question-design disciplines

1. **Ask relative to a carrier.** “What does the card's `Waiting on:` line literally say?” — not “which files were touched recently?”, which may have a defensible answer in another carrier too.
2. **Remove contamination from the material.** If the author's own prose paraphrases the card into the material, the no-card arm can infer from that paraphrase.
3. **Numbered rows = the scorer's self-reported answer-file count.** If three of four answers arrived, the table has a row saying “no reply” — never a filled-in number for a file that does not exist.

## 5. Search is measured from logs, not from self-report

Each probe runs as its own agent with its own session log. Count `tool/call` events in that log and compare the read paths against a **whitelist = the material we handed out**:

- reads inside the whitelist: not a search;
- reads outside it, plus a fixed list of research tools: count as searches.

Two traps, both encountered: (a) a whitelist hard-coded to one run directory reports false positives for every other run — parameterize it and **print the whitelist before the counts**; (b) tool-name and argument keys must be verified against a dumped raw event, since they are harness-version dependent.

## 6. Register and boundaries

- **Register the prediction before the run** (“arm A will quote the card; arm B will substitute”), and when the result contradicts the prediction, suspect the prediction first.
- **Zero-history probes are not real windows.** A run shows what happens *under this arrangement with this material*; it does not show what a working window does.
- **Noise floor**: measure it (two probes in the same arm) before interpreting the distance between arms.
- **A missing section is not evidence.** Report only what was actually observed; “it did not happen” may be written only for cases where someone reported on it.

## 7. Retention

Packs, raw verdicts, keys and the per-probe logs are retained inside the deployment. They are not published, because the packs contain real summary text; the aggregate verdict counts are published in the report.
