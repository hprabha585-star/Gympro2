# Full system audit — all fixes in this pass

## 🔴 The reported bug: superadmin login says "still pending approval"

**This is almost certainly a data issue, not a code bug** — but I found the
likely cause. Superadmin accounts have **no in-app approval button by
design** (see `SUPERADMIN_SETUP.md`) — the only way to approve one is a
direct SQL `UPDATE`, specifically so a compromised or careless in-app
action can never silently grant top-level access.

Your screenshot shows a login attempt for **`hprabha858@gmail.com`**. The
old (removed) `create-superadmin.js`/`create-admin.js` scripts — which were
still sitting in your uploaded files, leftover from before the security
cleanup described in `SUPERADMIN_SETUP.md` — hardcode a *different* email:
**`hprabha585@gmail.com`** (585, not 858). If you ran the approval SQL
against that old hardcoded email instead of the one you're actually
logging in with, the real pending row was never touched.

**Run this, with the exact email from your screenshot:**
```sql
UPDATE users
SET isApproved=1, pendingApproval=0, isActive=1
WHERE email='hprabha858@gmail.com';
```
Then check it actually matched a row (`SELECT ROW_COUNT();` right after, or
just re-run the `SELECT * FROM users WHERE email='hprabha858@gmail.com'`
first to confirm the row exists and see its current `isApproved`/
`pendingApproval` values before updating).

I did **not** include `create-admin.js` / `create-superadmin.js` in this
delivery — they contain hardcoded credentials and were already correctly
identified as a security risk and removed per your own docs. If they're
still in your actual deployed repo, delete them there too.

---

## Everything else I found and fixed

### 1. Stale files on your server vs. what you're actually running
Several files I found on disk (`index.html`, `login.html`,
`superadmin.html`) were **older versions** missing features that
`script.js`/`admin.js` already expect — e.g. `script.js` populates an
`#activeGymBanner` element that plain `index.html` didn't have; it calls
`/admin/pending-staff-password-resets` expecting `#gaResetList`/
`#gaResetBadge` that weren't in the page; the superadmin panel's "Manage
Gym" and "Password Resets" sections were missing their list containers.
I rebuilt these three files to match what the JS actually needs — full
files included in this zip, safe to deploy as complete replacements.

### 2. Broken "Forgot password?" on the login page
`login.html`'s `promptForgotPassword()` only asked for an email and sent
that alone to `POST /auth/request-password-reset` — but that route
requires **both** `email` and `newPassword`, so every attempt failed with
"Email and new password are required." Fixed to prompt for both.

### 3. Misleading "set new password" fields for approvers
Both `superadmin.html` (approving a gym-owner's reset) and the Gym Admin
panel in `script.js` (approving a staff member's reset) had an input field
implying the **approver** picks the new password. They don't — the backend
ignores that field entirely and applies whatever the account owner already
chose when they submitted the request. Worse, the gym-admin version
actively **blocked** approval unless something was typed in that dead
field. Removed both misleading inputs; approve/reject now do exactly what
they say.

### 4. Wrong field name silently blanking the "Requested" date
The staff password-reset list read `s.resetRequestedAt`, but the API
actually returns `pendingPasswordRequestedAt`. Fixed.

### 5. Multi-gym data leaking across gyms (`routes/admin.js`)
- **`POST /create-staff`** used `admin.gymId || admin.id` — always the
  owner's *primary* gym, ignoring whichever gym is actually active. If an
  owner switched to gym #2 via Manage Gym and added staff there, that
  staff silently ended up attached to gym #1 instead. Fixed to use the
  active gym from the token.
- **`PATCH /user/:userId/toggle`** and **`DELETE /user/:userId`** had **no
  ownership check at all** — any gym admin could toggle or delete *any*
  user by ID, including another gym's staff or owner account. Added checks
  so a gym admin can only act on their own staff, and superadmin can only
  toggle gym-owner accounts (matching how the UI actually uses this
  shared endpoint).
- **`GET /pending-staff-password-resets`**, **`approve-staff-password-reset`**,
  **`reject-staff-password-reset`** were all hardcoded to
  `req.user.userId` (primary gym only) instead of the active gym — same
  class of bug, same fix applied to all three.

### 6. Minor data leak
Several `GET` list endpoints excluded `password` from responses but not
`pendingPasswordHash` — a bcrypt hash of an unapproved new password,
unnecessarily exposed in API responses (e.g. the staff list an admin
views). Now excluded everywhere `password` is.

### 7. Relative asset paths (recurring issue)
`index.html` referenced `style.css`/`script.js` without a leading slash.
Since `server.js` serves `index.html` for *any* unmatched path, being on
any URL other than exactly `/` breaks those relative paths — CSS fails to
load and the page's own hide/show logic never runs, which looks exactly
like "no buttons, all pages merged." Fixed to absolute `/style.css` and
`/script.js`.

### 8. Retired the service worker
`sw.js` was still the old Cache-First version for HTML/CSS/JS with a
version string that never changes between deploys — the exact mechanism
that caused a real stale-cache bug before. `script.js` now actively
unregisters any service worker and clears all caches on load instead of
registering one; `sw.js` itself was replaced with a minimal
self-unregistering worker as a second line of defense for browsers that
still have an old one installed. This retires offline-caching entirely —
this app doesn't rely on it, and the caching layer had caused more bugs
than it solved.

## Everything I checked and found correct (no changes needed)
- `models/*.js` — all consistent, no bugs
- `config/database.js`, `middleware/auth.js`, `server.js` — no issues
- `routes/members.js`, `routes/attendance.js`, `routes/trainers.js`,
  `routes/qr-attendance.js` — all consistently scoped to the active gym
  already
- Every `onclick`/`onchange`/`oninput` handler in `index.html` resolves to
  an actual function in `script.js` (cross-checked programmatically)
- `admin.html` is dead code (only referenced by the old `sw.js`'s asset
  list, never actually linked to from `login.html` or `index.html`) —
  left as-is, harmless
