---
"@sobree/core": patch
---

Explicit `w:val="nil"` / `"none"` cell borders now suppress the table
grid on that edge instead of inheriting it. Banner tables declare a
fully-bordered grid at table level and carve the clean design per
cell — a CV's name box stayed outlined but its email row and photo
column grew grid lines Word never draws.
