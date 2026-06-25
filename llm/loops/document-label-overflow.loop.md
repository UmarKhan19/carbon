---
id: document-label-overflow
kind: bug
title: Document label × is clipped/hidden with 3-4+ labels
risk: low
acceptance:
- With 4+ labels on a document, every label's remove (×) control stays visible and clickable
- Labels wrap or scroll within their container instead of overflowing and clipping
- No regression to single/few-label rendering
---

When a document has 3–4 or more labels, the label container overflows horizontally and the × (remove) control on labels gets clipped/hidden — the user can't remove labels and is stuck. The container must wrap or scroll so every × stays reachable. Documents module (`apps/erp/app/modules/documents`).
