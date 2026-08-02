# Fix: pages "merged" / buttons unstyled (relative asset paths)

## What the screenshots showed
No CSS applied at all — default browser button styling, serif headings,
and every page's content stacked one after another on a single screen
(Dashboard content, then Settings content, then the superadmin Control
Panel content, all visible at once).

## Root cause
`frontend/index.html` referenced its own CSS and JS with **relative**
paths:
```html
<link rel="stylesheet" href="style.css">
...
<script src="script.js"></script>
```
Meanwhile `server.js` has a catch-all route:
```js
app.get('*', (req, res) => res.sendFile(path.join(frontendPath, 'index.html')));
```
which serves `index.html` for **any** unmatched URL path — not just `/`.

If the browser's current path is ever anything other than exactly `/`
(a bookmarked link, an old shortcut, any not-found path), the relative
`style.css`/`script.js` resolve **relative to that path** instead of the
site root, and both 404. That explains both symptoms at once:
- **No styling** — `style.css` never loaded, so every element falls back
  to the browser's default stylesheet.
- **"Pages merged"** — `script.js` never ran either, so `showPage()` never
  executes to hide inactive pages. Without the CSS rule `.page { display:
  none }` (which also never loaded) or the JS that toggles it, every
  `#page-*` div — Dashboard, Settings, the superadmin panel, all of
  them — just renders in normal document order, stacked on one screen.

This has nothing to do with the service worker fix from before; that
addressed *stale* cached files. This is a page that never successfully
loaded its CSS/JS in the first place, regardless of caching.

## Fix (`frontend/index.html`)
```html
<link rel="stylesheet" href="/style.css">
...
<script src="/script.js"></script>
```
Absolute paths always resolve to the site root no matter what the current
URL path is, so this can't happen again. I checked every other frontend
HTML file (`login.html`, `admin.html`, `superadmin.html`, `gym-qr.html`,
`member-checkin.html`, `scan-stats.html`) — none of them reference
`style.css`/`script.js` (they're self-contained with inline `<style>`/
`<script>`), so this was an isolated fix to just these two lines.
