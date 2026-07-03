---
"@sobree/core": patch
---

Footer zones render like the body. Rich header/footer content no longer
inherits the zone's centred presentation default — alignment belongs to
each paragraph's own properties, and Word's default is left; centring
now applies only to legacy string-template zones ("Page {page} of
{pages}"). And `<a:spAutoFit/>` text boxes size to their TEXT: the
stored extent is only the last-saved size that Word/LibreOffice re-fit
on layout, so pinning it floated ljmu-letterhead's footer address block
~13mm above Word's position (with the slack inside the box); the
auto-fit flag is read off `<wps:bodyPr>`, drives content-driven height
in the renderer, and round-trips through the Y.Doc.
