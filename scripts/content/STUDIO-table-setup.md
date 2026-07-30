# Enabling tables in the Sanity Studio

The article renderer in this repo now handles a `table` block. The matching
schema change lives in the **filetax-studio** repo and has to be made there
before a table can be authored.

The renderer expects the shape produced by the official `@sanity/table` plugin:

```json
{
  "_type": "table",
  "rows": [
    { "_type": "row", "_key": "…", "cells": ["Form 5472", "Form 5471"] },
    { "_type": "row", "_key": "…", "cells": ["Foreign-owned US entity", "US-owned foreign entity"] }
  ]
}
```

The first row is rendered as the header.

## Option A: use the official plugin (recommended)

In the **filetax-studio** repo:

```bash
npm install @sanity/table
```

`sanity.config.ts`:

```ts
import { table } from '@sanity/table'

export default defineConfig({
  // …
  plugins: [table()],
})
```

Then add `table` to the `body` array of the `post` schema:

```ts
defineField({
  name: 'body',
  title: 'Body',
  type: 'array',
  of: [
    { type: 'block' },
    { type: 'image', options: { hotspot: true } },
    { type: 'table' },
  ],
})
```

## Option B: hand-rolled, no plugin

If you would rather not add a dependency, define the two types yourself:

```ts
// schemas/objects/table.ts
import { defineType, defineField } from 'sanity'

export const tableRow = defineType({
  name: 'row',
  title: 'Row',
  type: 'object',
  fields: [
    defineField({
      name: 'cells',
      title: 'Cells',
      type: 'array',
      of: [{ type: 'string' }],
    }),
  ],
  preview: {
    select: { cells: 'cells' },
    prepare: ({ cells }) => ({ title: (cells || []).join(' | ') || 'Empty row' }),
  },
})

export const table = defineType({
  name: 'table',
  title: 'Table',
  type: 'object',
  fields: [
    defineField({
      name: 'rows',
      title: 'Rows',
      description: 'The first row is rendered as the header row.',
      type: 'array',
      of: [{ type: 'row' }],
    }),
  ],
  preview: {
    select: { rows: 'rows' },
    prepare: ({ rows }) => ({
      title: 'Table',
      subtitle: `${(rows || []).length} rows`,
    }),
  },
})
```

Register both in the schema list, then add `{ type: 'table' }` to the `body`
array exactly as in Option A.

## Constraints the renderer imposes

These are enforced by how the article page displays a table, so authoring
against them avoids surprises:

- **Cells are plain strings.** Bold, links, and nested lists inside a cell are
  not rendered. Keep cells to a few words or one short clause.
- **Four columns maximum in practice.** The article column is 740px. Wider
  tables scroll horizontally inside their own container, which is handled, but
  readability drops fast beyond four columns on a phone.
- **The first row is always the header.** There is no separate header toggle.
- **An empty `rows` array renders nothing** rather than an empty frame.

## Verifying it works

After the schema change, add a table to any post and check the article page.
The table should sit inside a rounded bordered container, header row on the
surface colour, and scroll sideways on a narrow viewport without the page body
scrolling.

No change is needed in this repo. The serializer is already in
`src/app/pages/Article.tsx` under `portableTextComponents.types.table`.
