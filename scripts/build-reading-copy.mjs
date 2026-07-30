// scripts/build-reading-copy.mjs
//
// Generates a single self-contained HTML file containing every post in Sanity,
// published and draft, for offline review. Read-only: performs no mutations.
//
//   node scripts/build-reading-copy.mjs
//
// Output goes to the path given by OUT, defaulting to ./filetax-content.html.

import { query } from './sanity-read.mjs';
import { writeFileSync } from 'node:fs';

const OUT = process.env.OUT || 'filetax-content.html';

const MERGE_PLAN = {
  'pro-forma-1120-explained': 'merge-target',
  'pro-forma-1120-every-field-foreign-owned-de': 'merge-source',
  'missed-form-5472-penalty-exposure-relief-paths': 'merge-target',
  'diirsp-reasonable-cause-fta-late-5472': 'merge-source',
  'filed-5472-multiple-years-late-penalty-exposure': 'merge-source',
};

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const spanText = (b) => (b.children || []).map((c) => c.text).join('');

function renderInline(block) {
  const defs = Object.fromEntries((block.markDefs || []).map((d) => [d._key, d]));
  return (block.children || [])
    .map((c) => {
      let out = esc(c.text);
      for (const m of c.marks || []) {
        if (m === 'strong') out = `<strong>${out}</strong>`;
        else if (m === 'em') out = `<em>${out}</em>`;
        else if (defs[m]) out = `<a href="${esc(defs[m].href)}" rel="noopener">${out}</a>`;
      }
      return out;
    })
    .join('');
}

function renderBody(body = []) {
  const out = [];
  let list = null;
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  for (const b of body) {
    if (b._type !== 'block') {
      closeList();
      out.push(`<p class="nonblock">[${esc(b._type)}]</p>`);
      continue;
    }
    if (b.listItem) {
      const tag = b.listItem === 'number' ? 'ol' : 'ul';
      if (list !== tag) {
        closeList();
        out.push(`<${tag}>`);
        list = tag;
      }
      out.push(`<li>${renderInline(b)}</li>`);
      continue;
    }
    closeList();
    const style = b.style || 'normal';
    if (style === 'h2') out.push(`<h2>${renderInline(b)}</h2>`);
    else if (style === 'h3') out.push(`<h3>${renderInline(b)}</h3>`);
    else if (style === 'blockquote') out.push(`<blockquote>${renderInline(b)}</blockquote>`);
    else out.push(`<p>${renderInline(b)}</p>`);
  }
  closeList();
  return out.join('\n');
}

const rows = await query(
  '*[_type=="post" && defined(slug.current)]{_id,"slug":slug.current,title,seoTitle,seoDescription,excerpt,publishedAt,body,"cat":categories[0]->title,"rel":count(relatedPosts)}|order(publishedAt asc)'
);

const posts = rows.map((p) => {
  const blocks = (p.body || []).filter((b) => b._type === 'block');
  const text = blocks.map(spanText).join('\n');
  const defs = (p.body || []).flatMap((b) => b.markDefs || []).filter((m) => m._type === 'link');
  return {
    ...p,
    draft: p._id.startsWith('drafts.'),
    chars: text.length,
    words: text.split(/\s+/).filter(Boolean).length,
    h2: blocks.filter((b) => b.style === 'h2').length,
    intLinks: defs.filter((m) => (m.href || '').startsWith('/')).length,
    extLinks: defs.filter((m) => /^https?:/.test(m.href || '')).length,
    html: renderBody(p.body),
  };
});

const live = posts.filter((p) => !p.draft);
const draft = posts.filter((p) => p.draft);
const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'no date');

const navItem = (p, i) => `
  <li>
    <button class="navlink" data-target="post-${i}">
      <span class="nav-date">${fmt(p.publishedAt)}</span>
      <span class="nav-title">${esc(p.title)}</span>
      <span class="nav-meta">${p.words}w &middot; ${p.h2} H2 &middot; ${p.intLinks} links${
        MERGE_PLAN[p.slug] ? ` &middot; <span class="flag-${MERGE_PLAN[p.slug]}">${MERGE_PLAN[p.slug] === 'merge-target' ? 'merge into' : 'merge away'}</span>` : ''
      }</span>
    </button>
  </li>`;

const article = (p, i) => `
  <article class="post" id="post-${i}">
    <header class="post-head">
      <div class="chips">
        <span class="chip ${p.draft ? 'chip-draft' : 'chip-live'}">${p.draft ? 'Scheduled' : 'Live'}</span>
        <span class="chip">${fmt(p.publishedAt)}</span>
        <span class="chip">${esc(p.cat || 'uncategorised')}</span>
        <span class="chip">${p.words} words</span>
        <span class="chip ${p.intLinks === 0 ? 'chip-warn' : ''}">${p.intLinks} internal links</span>
        <span class="chip">${p.extLinks} external</span>
        <span class="chip ${p.rel ? '' : 'chip-warn'}">${p.rel || 0} related</span>
        ${MERGE_PLAN[p.slug] ? `<span class="chip chip-flag">${MERGE_PLAN[p.slug]}</span>` : ''}
      </div>
      <h1>${esc(p.title)}</h1>
      <p class="slug"><code>/resources/${esc(p.slug)}</code></p>
      <dl class="seo">
        <dt>SEO title</dt><dd>${esc(p.seoTitle || '')} <span class="count">${(p.seoTitle || '').length}</span></dd>
        <dt>Meta description</dt><dd>${esc(p.seoDescription || '')} <span class="count">${(p.seoDescription || '').length}</span></dd>
        <dt>Excerpt</dt><dd>${esc(p.excerpt || '')} <span class="count">${(p.excerpt || '').length}</span></dd>
      </dl>
    </header>
    <div class="body">${p.html}</div>
    <p class="totop"><button class="navlink-top">Back to index</button></p>
  </article>`;

const html = `<title>FileTax content library</title>
<style>
  :root {
    --paper: #FBFCFD; --ink: #131A21; --muted: #64727E; --rule: #DCE3E9;
    --accent: #0F6FA8; --flag: #A3341F; --chip: #EEF2F5; --surface: #FFFFFF;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #10151B; --ink: #E3E9EF; --muted: #8A98A6; --rule: #232D37;
      --accent: #5BB2E5; --flag: #E08B72; --chip: #1B232C; --surface: #151C24;
    }
  }
  :root[data-theme="dark"] {
    --paper: #10151B; --ink: #E3E9EF; --muted: #8A98A6; --rule: #232D37;
    --accent: #5BB2E5; --flag: #E08B72; --chip: #1B232C; --surface: #151C24;
  }
  :root[data-theme="light"] {
    --paper: #FBFCFD; --ink: #131A21; --muted: #64727E; --rule: #DCE3E9;
    --accent: #0F6FA8; --flag: #A3341F; --chip: #EEF2F5; --surface: #FFFFFF;
  }

  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font-family: Georgia, 'Iowan Old Style', Charter, 'Times New Roman', serif;
    line-height: 1.65;
  }
  .sans { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
  code, .mono, .chip, .nav-date, .nav-meta, .count {
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  }

  .wrap { display: grid; grid-template-columns: 330px minmax(0, 1fr); gap: 0; }
  @media (max-width: 900px) { .wrap { grid-template-columns: 1fr; } }

  /* Index rail */
  .rail {
    border-right: 1px solid var(--rule); background: var(--surface);
    height: 100vh; position: sticky; top: 0; overflow-y: auto; padding: 1.5rem 1.1rem 3rem;
  }
  @media (max-width: 900px) { .rail { height: auto; position: static; border-right: 0; border-bottom: 1px solid var(--rule); } }
  .rail h2 {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: .7rem; text-transform: uppercase; letter-spacing: .1em; color: var(--muted);
    margin: 1.6rem 0 .5rem; font-weight: 600;
  }
  .rail h2:first-of-type { margin-top: 1.2rem; }
  .brand {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-weight: 700; font-size: 1rem; letter-spacing: -.01em; margin: 0 0 .2rem;
  }
  .brand-sub { color: var(--muted); font-size: .8rem; margin: 0 0 1rem; }
  #search {
    width: 100%; padding: .5rem .6rem; border: 1px solid var(--rule); border-radius: 4px;
    background: var(--paper); color: var(--ink); font-size: .85rem;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }
  #search:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .rail ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .1rem; }
  .navlink {
    display: flex; flex-direction: column; gap: .1rem; width: 100%; text-align: left;
    background: none; border: 0; border-left: 2px solid transparent; cursor: pointer;
    padding: .45rem .5rem; color: inherit; border-radius: 0 3px 3px 0;
  }
  .navlink:hover { background: var(--chip); }
  .navlink:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .navlink.active { border-left-color: var(--accent); background: var(--chip); }
  .nav-date { font-size: .65rem; color: var(--muted); letter-spacing: .02em; }
  .nav-title {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: .82rem; line-height: 1.3; font-weight: 500;
  }
  .nav-meta { font-size: .62rem; color: var(--muted); }
  .flag-merge-target { color: var(--accent); }
  .flag-merge-source { color: var(--flag); }

  /* Reading column */
  main { padding: 2.5rem 2rem 6rem; }
  @media (max-width: 900px) { main { padding: 1.5rem 1.1rem 4rem; } }
  .post { max-width: 66ch; margin: 0 auto 5rem; display: none; }
  .post.active { display: block; }
  .post-head { border-bottom: 1px solid var(--rule); padding-bottom: 1.4rem; margin-bottom: 1.8rem; }
  .post h1 {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: clamp(1.5rem, 3.2vw, 2.05rem); line-height: 1.2; letter-spacing: -.02em;
    text-wrap: balance; margin: .7rem 0 .5rem;
  }
  .chips { display: flex; flex-wrap: wrap; gap: .3rem; }
  .chip {
    font-size: .64rem; padding: .18rem .45rem; border-radius: 3px;
    background: var(--chip); color: var(--muted); letter-spacing: .02em; white-space: nowrap;
  }
  .chip-live { background: var(--accent); color: var(--surface); }
  .chip-draft { background: var(--flag); color: var(--surface); }
  .chip-warn { color: var(--flag); font-weight: 700; }
  .chip-flag { border: 1px dashed var(--flag); color: var(--flag); }
  .slug { margin: 0 0 1rem; }
  .slug code { font-size: .75rem; color: var(--muted); }
  .seo { margin: 0; display: grid; grid-template-columns: max-content minmax(0,1fr); gap: .2rem .8rem; font-size: .8rem; }
  .seo dt {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    color: var(--muted); font-size: .68rem; text-transform: uppercase; letter-spacing: .06em; padding-top: .15rem;
  }
  .seo dd { margin: 0; color: var(--ink); }
  .count { color: var(--muted); font-size: .65rem; }

  .body h2 {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 1.12rem; letter-spacing: -.01em; margin: 2.2rem 0 .6rem; text-wrap: balance;
  }
  .body h3 {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: .95rem; margin: 1.5rem 0 .4rem; color: var(--muted);
  }
  .body p { margin: 0 0 1rem; }
  .body ul, .body ol { margin: 0 0 1rem; padding-left: 1.3rem; }
  .body li { margin-bottom: .35rem; }
  .body blockquote {
    margin: 1.2rem 0; padding: .6rem 1rem; border-left: 3px solid var(--accent);
    background: var(--chip); font-style: normal; font-size: .92rem;
  }
  .body a { color: var(--accent); }
  .nonblock { color: var(--flag); font-size: .8rem; }
  .totop { margin-top: 2.5rem; border-top: 1px solid var(--rule); padding-top: 1rem; }
  .navlink-top {
    background: none; border: 0; color: var(--accent); cursor: pointer; padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size: .85rem;
  }
  .empty { color: var(--muted); max-width: 66ch; margin: 0 auto; }
  .empty h1 {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 1.6rem; letter-spacing: -.02em; color: var(--ink);
  }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px,1fr)); gap: .8rem; margin: 1.5rem 0; }
  .stat { border: 1px solid var(--rule); border-radius: 4px; padding: .7rem .8rem; background: var(--surface); }
  .stat b {
    display: block; font-size: 1.5rem; line-height: 1.1;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums;
  }
  .stat span {
    font-size: .68rem; color: var(--muted); text-transform: uppercase; letter-spacing: .06em;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }
  .stat.warn b { color: var(--flag); }
</style>

<div class="wrap">
  <nav class="rail">
    <p class="brand">FileTax content library</p>
    <p class="brand-sub">${live.length} live &middot; ${draft.length} scheduled</p>
    <label for="search" style="position:absolute;left:-9999px">Search articles</label>
    <input id="search" type="search" placeholder="Filter by title or slug" autocomplete="off">
    <h2>Live (${live.length})</h2>
    <ul id="list-live">${live.map((p) => navItem(p, posts.indexOf(p))).join('')}</ul>
    <h2>Scheduled (${draft.length})</h2>
    <ul id="list-draft">${draft.map((p) => navItem(p, posts.indexOf(p))).join('')}</ul>
  </nav>

  <main>
    <div class="empty" id="empty">
      <h1>Every post, in one place</h1>
      <p>${live.length} published articles and ${draft.length} scheduled drafts, pulled straight from Sanity. Pick one from the index to read it in full, with its SEO fields and structural metrics shown above the text.</p>
      <div class="stat-grid">
        <div class="stat"><b>${posts.reduce((a, p) => a + p.words, 0).toLocaleString()}</b><span>total words</span></div>
        <div class="stat"><b>${Math.round(posts.reduce((a, p) => a + p.words, 0) / posts.length)}</b><span>avg words</span></div>
        <div class="stat warn"><b>${posts.reduce((a, p) => a + p.intLinks, 0)}</b><span>internal links</span></div>
        <div class="stat"><b>${posts.reduce((a, p) => a + p.extLinks, 0)}</b><span>external links</span></div>
      </div>
      <p>Every article carries the same skeleton: an opening, a <em>What You Need to Know First</em> block, body sections, a <em>What This Means for Your Filing</em> close, and exactly six FAQ questions. That uniformity is the main thing limiting how many distinct queries each page can rank for.</p>
      <p>Articles marked <span class="flag-merge-source">merge away</span> are proposed to fold into the ones marked <span class="flag-merge-target">merge into</span>.</p>
    </div>
    ${posts.map((p, i) => article(p, i)).join('')}
  </main>
</div>

<script>
  (function () {
    var posts = document.querySelectorAll('.post');
    var links = document.querySelectorAll('.navlink');
    var empty = document.getElementById('empty');

    function show(id) {
      posts.forEach(function (p) { p.classList.toggle('active', p.id === id); });
      links.forEach(function (l) { l.classList.toggle('active', l.dataset.target === id); });
      empty.style.display = id ? 'none' : '';
      if (id) window.scrollTo({ top: 0, behavior: 'instant' });
    }

    links.forEach(function (l) {
      l.addEventListener('click', function () { show(l.dataset.target); });
    });
    document.querySelectorAll('.navlink-top').forEach(function (b) {
      b.addEventListener('click', function () { show(null); });
    });

    document.getElementById('search').addEventListener('input', function (e) {
      var q = e.target.value.toLowerCase();
      links.forEach(function (l) {
        l.parentElement.style.display = l.textContent.toLowerCase().indexOf(q) > -1 ? '' : 'none';
      });
    });
  })();
</script>`;

writeFileSync(OUT, html, 'utf8');
console.log(`Wrote ${OUT} (${(html.length / 1024).toFixed(0)} kB, ${posts.length} posts)`);
