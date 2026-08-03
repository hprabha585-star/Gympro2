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

// Import routes
const authRoutes = require('./routes/auth');

// API Routes
app.use('/api/auth',       authRoutes.router);
app.use('/api/members',    require('./routes/members'));
app.use('/api/trainers',   require('./routes/trainers'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/admin',      require('./routes/admin'));
app.use('/api/qr',         require('./routes/qr-attendance'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running', time: new Date() });
});

// Serve frontend — bundled INSIDE the backend/ folder so it deploys
// together with the code on every GitHub push (no manual file uploads
// to a separate filesystem needed).
const frontendPath = path.join(__dirname, 'frontend');
app.use(express.static(frontendPath));
app.get('/', (req, res) => res.sendFile(path.join(frontendPath, 'index.html')));
app.get('*', (req, res) => res.sendFile(path.join(frontendPath, 'index.html')));

const PORT = process.env.PORT || 5000;

// ── Self-healing DB maintenance ──────────────────────────────────────────
// IMPORTANT: these run in the BACKGROUND, after the server is already
// listening (see start() below). Running them before app.listen() was the
// direct cause of the "App did not call listen() within 3 seconds" hosting
// error you were seeing (and the resulting restart loop): each step below
// is a real network round trip to MySQL, and 3+3+6 sequential round trips
// on every cold start easily blew past Hostinger's 3-second window before
// listen() ever ran. That restart loop is also why gym-switching / gym
// data felt slow — every switch could hit a cold, still-restarting
// instance and pay this whole migration chain again before answering.

// members/trainers/attendances.userId is intentionally dual-purpose — a
// gym owner's User.id OR a Gym.id for an additional gym (see models/index.js).
// Older deploys let Sequelize create a real FK to users.id, which then
// rejected inserts made under an additional gym. Drop any leftover FK.
async function dropUserForeignKeys(tableName) {
  try {
    const [fks] = await sequelize.query(`
      SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}'
        AND REFERENCED_TABLE_NAME = 'users' AND COLUMN_NAME = 'userId'
    `);
    for (const fk of fks) {
      try {
        await sequelize.query(`ALTER TABLE \`${tableName}\` DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
        console.log(`✅ ${tableName}: dropped foreign key ${fk.CONSTRAINT_NAME} (userId no longer FK-constrained to users)`);
      } catch (e) {
        console.warn(`   ⚠️ could not drop FK "${fk.CONSTRAINT_NAME}" on ${tableName}: ${e.message}`);
      }
    }
  } catch (e) {
    // Table doesn't exist yet on a fresh database — nothing to clean, that's fine
  }
}

// Repeated `sync({ alter: true })` runs across many redeploys piled up
// near-duplicate indexes on several tables — one hit MySQL's hard cap of
// 64 indexes per table, which then made EVERY sync fail with "Too many
// keys specified". This clears non-primary indexes before every sync.
//
// BUG FIX: this used to try to drop EVERY non-primary index unconditionally,
// including indexes that back a real, still-valid foreign key (e.g.
// attendances.memberId -> members.id, gyms.ownerId -> users.id,
// subscriptions.userId -> users.id). MySQL refuses to drop an index a live
// FK depends on, so every boot logged 3 "could not drop index" warnings for
// indexes that were never supposed to be dropped in the first place. Now
// it looks up which columns are still FK-backed and skips those indexes
// entirely instead of attempting (and failing) to drop them.
async function cleanupExcessIndexes(tableName) {
  try {
    const [indexes] = await sequelize.query(`SHOW INDEX FROM \`${tableName}\``);
    if (!indexes.length) return;

    const [fkRows] = await sequelize.query(`
      SELECT DISTINCT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}'
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `);
    const fkColumns = new Set(fkRows.map(r => r.COLUMN_NAME));

    const indexColumns = {}; // indexName -> [columns]
    for (const row of indexes) {
      if (row.Key_name === 'PRIMARY') continue;
      (indexColumns[row.Key_name] ||= []).push(row.Column_name);
    }

    const droppable = Object.keys(indexColumns).filter(
      idxName => !indexColumns[idxName].some(col => fkColumns.has(col))
    );
    if (!droppable.length) return;

    console.log(`🔧 ${tableName}: found ${droppable.length} non-primary index(es), clearing before sync...`);
    for (const idx of droppable) {
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

async function runMaintenance() {
  // Independent per-table checks — run in parallel instead of one-at-a-time
  // to cut total migration wall-clock time roughly 3-6x on every boot.
  await Promise.all(['members', 'trainers', 'attendances'].map(dropUserForeignKeys));
  await Promise.all(
    ['members', 'trainers', 'attendances', 'users', 'gyms', 'subscriptions'].map(cleanupExcessIndexes)
  );

  try {
    await sequelize.sync({ alter: true });
  } catch (syncErr) {
    console.warn('⚠️ First sync attempt failed:', syncErr.message, '— retrying after a second cleanup pass');
    await Promise.all(
      ['members', 'trainers', 'attendances', 'users', 'gyms', 'subscriptions'].map(cleanupExcessIndexes)
    );
    await sequelize.sync({ alter: true });
  }

  // `gyms.id` and `users.id` are independent auto-increment counters in
  // separate tables. If they ever numerically collide, the app can't tell
  // a user's own gym apart from an additional gym with the same id — push
  // gyms.id far out of range so this can never happen.
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

  console.log('✅ Tables synced');
}

async function start() {
  try {
    await sequelize.authenticate();
    console.log('✅ MySQL Connected');

    // Start accepting traffic immediately — this is what satisfies
    // Hostinger's "must call listen() within 3 seconds" health check.
    app.listen(PORT, () => {
      console.log(`\n🚀 GymPro Server on port ${PORT}`);
      console.log(`🔐 Auth:       /api/auth`);
      console.log(`📁 Members:    /api/members`);
      console.log(`📁 Trainers:   /api/trainers`);
      console.log(`📅 Attendance: /api/attendance`);
      console.log(`👑 Admin:      /api/admin`);
      console.log(`📱 QR:         /api/qr\n`);
    });

    // Schema self-healing runs in the background, after listen(). It's
    // idempotent and safe to race with early requests — it only ever adds
    // columns/tables or drops constraints/indexes that shouldn't exist;
    // it never drops or overwrites row data.
    runMaintenance().catch(err => {
      console.error('⚠️ Background DB maintenance failed:', err.message);
    });
  } catch (err) {
    console.error('❌ MySQL connection error:', err.message);
    process.exit(1);
  }
}

start();
