# Two critical fixes: server crash-loop + broken Manage Gym database design

## 🔴 Bug 1: "Manage Gym" was fundamentally broken at the database level

**This explains the "Add Member" error** (`Cannot add or update a child row:
a foreign key constraint fails ... FOREIGN KEY (userId) REFERENCES users
(id)`), and would have hit trainers and attendance too, for anyone
working inside an **additional gym**.

### Root cause
`Member.userId` (and `Trainer.userId`, `Attendance.userId`) is
**intentionally polymorphic** by this app's own design:
- For an owner's **primary** gym, `userId` = their own `users.id`.
- For an **additional** gym (added via Manage Gym), `userId` = that gym's
  `gyms.id` — which `server.js` deliberately pushes to 1,000,000+
  specifically "to avoid collisions with user ids". That comment only
  makes sense if the intent was for `userId` to validly hold values from
  *either* table.

But `models/index.js` had Sequelize associations
(`Member.belongsTo(User, { foreignKey: 'userId' })`, same for Trainer and
Attendance) that **auto-create a real MySQL foreign key** tying `userId`
strictly to `users.id`. A foreign key can only reference one table — so
the moment someone switched into an additional gym and tried to add a
member (or trainer, or mark attendance), the insert used that gym's
`gyms.id` as `userId`, and MySQL rejected it outright because that id
doesn't exist in `users`. **Additional gyms could never actually have
members, trainers, or attendance added to them at all**, from day one.

### Fix
- `models/index.js`: added `constraints: false` to those three
  associations, so Sequelize stops creating a real foreign key on
  `userId` for Member/Trainer/Attendance (their other indexes — phone
  uniqueness, expiry, status — are untouched, only the FK is affected).
- `server.js`: since your database already has the old foreign keys from
  previous deploys, and Sequelize's `sync({ alter: true })` doesn't
  reliably drop existing foreign keys on its own, added a self-healing
  step (same pattern as the existing index-cleanup code) that finds and
  drops any foreign key on `members.userId`, `trainers.userId`, and
  `attendances.userId` on every startup, before syncing. This runs
  automatically on your next deploy — no manual SQL needed.

`Attendance.memberId → Member.id` and `Gym.ownerId → User.id` were left
as real foreign keys — those are never polymorphic, so the constraint is
correct and worth keeping there.

## 🔴 Bug 2: Server crash-looping — "App did not call listen() within 3 seconds"

Your runtime logs showed exactly this Hostinger diagnostic. The cause:
`app.listen()` was only called at the very end of an async chain —
`sequelize.authenticate()` → cleanup queries across 6 tables → a full
`sync({ alter: true })` (with a retry-with-cleanup fallback on failure) →
an `AUTO_INCREMENT` check. On shared hosting, that chain can legitimately
take longer than Hostinger's ~3 second startup deadline, especially right
after a deploy when there's more to reconcile — and when it does,
Hostinger kills the whole process for "hanging at startup", which is
exactly the crash-loop pattern in your logs (repeated restarts, port
already bound errors, etc.).

### Fix (`server.js`)
Restructured so `app.listen()` happens **immediately** — before any
database work — so the HTTP server is always accepting connections well
within Hostinger's window. Static frontend files and `/api/health` work
right away. All the database setup (the index/FK cleanup, the sync, the
AUTO_INCREMENT safety check) now runs in the background afterward; while
it's still running, `/api/*` routes return a clear
`503 { error: "Server is still starting up..." }` for the few seconds
that takes, instead of the whole process being killed. Once setup
finishes, a `dbReady` flag flips and API routes work normally — you can
check `GET /api/health` any time to see `dbReady: true/false`.

Also removed the `process.exit(1)` on a database connection failure — if
the DB has a transient hiccup, the server now stays up (serving the
frontend and a 503 for API calls) instead of taking the whole app down,
which gives it a chance to recover on the next connection attempt rather
than needing a manual restart.

## What to do after deploying this
Just deploy normally — no manual database steps needed. On the next
startup, the log will show the new self-healing foreign-key cleanup
running (similar log lines to the existing index cleanup you've seen
before), and the server should come up immediately instead of taking
several seconds before `listen()`.
