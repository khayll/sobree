---
"@sobree/core": patch
---

Table cells drop the space-after of their LAST block — the semantic rule
Word and LibreOffice apply (LO's Word-compat "AddParaTableSpacing") —
replacing the value-matching tightener that zeroed only margins equal to
the 240-twip default. The heuristic missed other document defaults
(nih-icsc's 200-twip after-spacing kept ~13px on 100+ single-paragraph
table rows — 2 extra pages vs LibreOffice) and its companion line-height
clamp (1.05–1.29 → 1) started mis-firing on every cell paragraph once
explicit natural-leading line-heights landed. Inter-block spacing inside
cells is preserved as authored.
