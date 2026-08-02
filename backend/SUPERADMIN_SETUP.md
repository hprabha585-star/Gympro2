# Creating a Super Admin Account (No Hardcoded Credentials)

`create-admin.js` and `create-superadmin.js` have been removed — they
contained a hardcoded email and password committed directly in the
codebase, which was a real security risk (anyone with repo access could
see and use those credentials). There is no script-based shortcut anymore.

There are now exactly two ways to get a super-admin account, and both
require deliberate action — no account is ever auto-created or auto-approved.

---

## Option A — Bootstrap the very first super-admin (one-time)

Before any super-admin exists, you need to promote a regular account
yourself, directly in the database:

1. Register a normal account through `/login.html` (any email/password you want)
2. In phpMyAdmin → your database → SQL tab, run:
   ```sql
   UPDATE users
   SET role='superadmin', isApproved=1, pendingApproval=0, isActive=1
   WHERE email='your-email@example.com';
   ```
3. Log in on the **Super Admin** tab with that email/password

---

## Option B — An existing super-admin requests another one

Once at least one super-admin exists, they can submit a request for a new
super-admin account from their dashboard (**Superadmin → Create Super Admin
Account**). This does **not** activate the account automatically — it's
created with `isApproved = false`. You (the site owner) must explicitly
approve it:

```sql
UPDATE users
SET isApproved=1, pendingApproval=0
WHERE email='the-new-superadmin-email@example.com';
```

Only after this SQL runs can that account log in.

---

## Why it works this way

Super-admin is the highest privilege level in the app — it can approve or
remove any gym, and now also approve/reject additional gyms under existing
owners. Requiring a manual database step (rather than any in-app
self-service flow) means a compromised or careless in-app action can never
silently grant someone top-level access — you always have to deliberately
go into the database yourself to finalize it.
