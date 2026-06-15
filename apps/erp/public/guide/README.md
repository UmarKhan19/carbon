# Guide screenshots

Screenshots for the written user guide (`/guide`) live here, one folder per
chapter slug:

```
public/guide/<chapter-slug>/<section-id>-<n>.png
```

For example, the "Working with revisions" section (`id: "revisions"`) of the
Items chapter (`slug: "items"`) would be `public/guide/items/revisions-1.png`.

## Filling a slot

Each `{ kind: "screenshot" }` block in
`app/routes/guide+/guide-content.ts` ships with `src: ""`, which renders a
labelled placeholder. To wire up a real screenshot:

1. Capture the screen described by the block's `alt` text.
2. Save it under the path above.
3. Set the block's `src` to the public path, e.g.
   `src: "/guide/items/revisions-1.png"`.

No component changes are needed — `ScreenshotSlot` swaps the placeholder for a
zoomable lightbox as soon as `src` is non-empty.

## Capturing

Use a consistent viewport and capture against demo data (the Helio or ACME
environments, or a locally seeded dev server). Higher-resolution captures look
better in the lightbox.
