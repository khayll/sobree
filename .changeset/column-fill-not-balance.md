---
"@sobree/core": patch
---

Multi-column sections now fill column-first when they end at a hard page
break, matching Word. Word balances a section's columns only at a
continuous section break (or document end); a section terminated by a
`nextPage` / `evenPage` / `oddPage` break fills column 0 to the page bottom,
then column 1 (newspaper order). The renderer previously balanced every
multi-column section's last page, so a short two-column page that Word would
fill came out as two half-height columns. The balance-vs-fill decision is now
driven by the terminating section break type, and a section begun by a hard
page break also gets the whole page as its first-column budget (it starts on
a fresh page). No API change; affects only how multi-column sections paginate.
