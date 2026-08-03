const dotenv = require('dotenv');
const path   = require('path');
dotenv.config();

const express  = require('express');
const cors     = require('cors');
const { sequelize } = require('./models'); // loads models + associations

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Tracks whether the DB setup below has finished. Gates only /api/* traffic
// (never static frontend files) so a slow/still-running migration returns a
// clear, fast 503 instead of a confusing raw connection error during the
// startup race window.
let dbReady = false;
app.use((req, res, next) => {
  if (!dbReady && req.path.startsWith('/api/') && req.path !== '/api/health') {
    return res.status(503).json({ error: 'Server is still starting up — please retry in a few seconds.' });
  }
  next();
});

// Import routes
const authRoutes = require('./routes/auth');

// API Routes
app.use('/api/auth',       authRoutes.router);
app.use('/api/members',    require('./routes/members'));
app.use('/api/trainers',   require('./routes/trainers'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/admin',      require('./routes/admin'));
app.use('/api/qr',         require('./routes/qr-attendance'));

// Health check — always answers, even before the DB finishes setting up,
// so Hostinger's startup probe (and anyone checking status) gets a real
// response instead of a hang.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', dbReady, message: 'Server is running', time: new Date() });
});

// Serve frontend — bundled INSIDE the backend/ folder so it deploys
// together with the code on every GitHub push (no manual file uploads
// to a separate filesystem needed).
const frontendPath = path.join(__dirname, 'frontend');
app.use(express.static(frontendPath));
app.get('/', (req, res) => res.sendFile(path.join(frontendPath, 'index.html')));
app.get('*', (req, res) => res.sendFile(path.join(frontendPath, 'index.html')));

const PORT = process.env.PORT || 5000;

// IMPORTANT: bind to the port immediately, before any database work.
// Hostinger's Node.js hosting kills the process if listen() isn't called
// within ~3 seconds of startup — but the DB migration work below (index
// cleanup + foreign-key cleanup across 6 tables, then a full alter-sync)
// can legitimately take longer than that on shared hosting. Previously
// listen() only happened at the very end of that chain, so any slowdown
// there took the whole app down with "App did not call listen() within
// 3 seconds" / "hanging at startup". Now the HTTP server starts serving
// immediately (static frontend + health check work right away), and API
// routes return a clear 503 for the few seconds DB setup is still running,
// instead of the process being killed outright.
app.listen(PORT, () => {
  console.log(`\n🚀 GymPro Server listening on port ${PORT} (database setup running in background)`);
  console.log(`🔐 Auth:       /api/auth`);
  console.log(`📁 Members:    /api/members`);
  console.log(`📁 Trainers:   /api/trainers`);
  console.log(`📅 Attendance: /api/attendance`);
  console.log(`👑 Admin:      /api/admin`);
  console.log(`📱 QR:         /api/qr\n`);
});

async function initDatabase() {
  try {
    await sequelize.authenticate();
    console.log('✅ MySQL Connected');

    // SELF-HEALING: repeated `sync({ alter: true })` runs across many
    // redeploys piled up near-duplicate indexes on several tables — one
    // hit MySQL's hard cap of 64 indexes per table, which then made EVERY
    // sync fail with "Too many keys specified". This runs UNCONDITIONALLY
    // on every startup now (not just past a threshold) and covers every
    // table in the app, so it can't miss the actual offending one again.
    // Dropping and letting sync() immediately rebuild the (now stably
    // named) indexes is safe — it never touches actual row data.
    async function cleanupExcessIndexes(tableName) {
      try {
        const [indexes] = await sequelize.query(`SHOW INDEX FROM \`${tableName}\``);
        const nonPrimary = [...new Set(indexes.filter(i => i.Key_name !== 'PRIMARY').map(i => i.Key_name))];
        if (!nonPrimary.length) return;
        console.log(`🔧 ${tableName}: found ${nonPrimary.length} non-primary index(es), clearing before sync...`);
        for (const idx of nonPrimary) {
          try {
            await sequelize.query(`ALTER TABLE \`${tableName}\` DROP INDEX \`${idx}\``);
          } catch (e) {
            console.warn(`   ⚠️ could not drop index "${idx}" on ${tableName}: ${e.message}`);
          }
        }
        console.log(`✅ ${tableName}: index cleanup done`);
      } catch (e) {
        // Table doesn't exist yet on a fresh database — nothing to clean, that's fine
      }
    }

    // SELF-HEALING: Member/Trainer/Attendance.userId is intentionally
    // polymorphic (a users.id for a primary gym, a gyms.id for an
    // additional gym — see models/index.js). Earlier deploys had Sequelize
    // auto-create a real foreign key tying userId to users.id, which made
    // every insert fail with "Cannot add or update a child row" the moment
    // someone worked inside an additional gym. The model association was
    // fixed to constraints:false, but that only stops NEW foreign keys
    // from being created — an already-deployed database still has the old
    // one sitting on the table, and { alter: true } does not reliably
    // drop foreign keys on its own. Find and drop it explicitly, on every
    // table that has this polymorphic userId column, before syncing.
    async function dropForeignKeyOnColumn(tableName, columnName) {
      try {
        const [rows] = await sequelize.query(`
          SELECT CONSTRAINT_NAME
          FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = '${tableName}'
            AND COLUMN_NAME = '${columnName}'
            AND REFERENCED_TABLE_NAME IS NOT NULL
        `);
        for (const row of rows) {
          try {
            await sequelize.query(`ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${row.CONSTRAINT_NAME}\``);
            console.log(`✅ ${tableName}: dropped foreign key ${row.CONSTRAINT_NAME} on ${columnName} (userId is intentionally polymorphic, not a strict users.id reference)`);
          } catch (e) {
            console.warn(`   ⚠️ could not drop foreign key ${row.CONSTRAINT_NAME} on ${tableName}.${columnName}: ${e.message}`);
          }
        }
      } catch (e) {
        // Table doesn't exist yet on a fresh database — nothing to clean, that's fine
      }
    }

    for (const t of ['members', 'trainers', 'attendances', 'users', 'gyms', 'subscriptions']) {
      await cleanupExcessIndexes(t);
    }
    for (const t of ['members', 'trainers', 'attendances']) {
      await dropForeignKeyOnColumn(t, 'userId');
    }

    // Creates tables if they don't exist yet. Safe to leave on Hostinger;
    // it will NOT drop or overwrite existing tables/data.
    // { alter: true } lets sync() add new columns to EXISTING tables too
    // (plain sync() only creates missing tables — it silently skips new
    // fields added to a model later, which caused the "Unknown column"
    // 500 errors after pendingAmount was added). Safe for additive changes;
    // it will not drop existing columns or data.
    try {
      await sequelize.sync({ alter: true });
    } catch (syncErr) {
      // Last-resort fallback: if sync STILL fails (e.g. index/FK cleanup
      // above missed something), clear everything unconditionally one
      // more time and retry once before giving up.
      console.warn('⚠️ First sync attempt failed:', syncErr.message, '— retrying after a second cleanup pass');
      for (const t of ['members', 'trainers', 'attendances', 'users', 'gyms', 'subscriptions']) {
        await cleanupExcessIndexes(t);
      }
      for (const t of ['members', 'trainers', 'attendances']) {
        await dropForeignKeyOnColumn(t, 'userId');
      }
      await sequelize.sync({ alter: true });
    }

    // SAFETY: `gyms.id` and `users.id` are independent auto-increment
    // counters in separate tables. If they ever numerically collide (e.g.
    // both currently at 2), the app can't tell a user's own gym apart from
    // an additional gym with the same id — a real data-isolation risk, not
    // just a display bug. Push gyms.id far out of range so this can never
    // happen, without needing any manual SQL.
    try {
      const [[row]] = await sequelize.query(
        "SELECT AUTO_INCREMENT AS next FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gyms'"
      );
      if (row && row.next < 1000000) {
        await sequelize.query('ALTER TABLE gyms AUTO_INCREMENT = 1000000');
        console.log('✅ gyms table id range pushed to 1,000,000+ to avoid collisions with user ids');
      }
    } catch (e) {
      console.warn('⚠️ Could not verify/adjust gyms AUTO_INCREMENT:', e.message);
    }

    dbReady = true;
    console.log('✅ Database ready — API routes are now live');
  } catch (err) {
    console.error('❌ Database setup failed:', err.message);
    console.error('   The HTTP server is still running (health check + static frontend work),');
    console.error('   but /api/* routes will keep returning 503 until this is resolved and the app restarts.');
    // Deliberately not process.exit(1) here — killing the process on a
    // transient DB hiccup means Hostinger sees the whole app crash instead
    // of a server that's up and can recover on the next connection retry.
  }
}

initDatabase();
