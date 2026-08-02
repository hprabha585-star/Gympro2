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
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));
app.get('/', (req, res) => res.sendFile(path.join(frontendPath, 'index.html')));
app.get('*', (req, res) => res.sendFile(path.join(frontendPath, 'index.html')));

const PORT = process.env.PORT || 5000;

async function start() {
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
    for (const t of ['members', 'trainers', 'attendances', 'users', 'gyms', 'subscriptions']) {
      await cleanupExcessIndexes(t);
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
      // Last-resort fallback: if sync STILL fails (e.g. index cleanup above
      // missed something), clear every table's indexes unconditionally
      // one more time and retry once before giving up.
      console.warn('⚠️ First sync attempt failed:', syncErr.message, '— retrying after a second cleanup pass');
      for (const t of ['members', 'trainers', 'attendances', 'users', 'gyms', 'subscriptions']) {
        await cleanupExcessIndexes(t);
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
    console.log('✅ Tables synced');

    app.listen(PORT, () => {
      console.log(`\n🚀 GymPro Server on port ${PORT}`);
      console.log(`🔐 Auth:       /api/auth`);
      console.log(`📁 Members:    /api/members`);
      console.log(`📁 Trainers:   /api/trainers`);
      console.log(`📅 Attendance: /api/attendance`);
      console.log(`👑 Admin:      /api/admin`);
      console.log(`📱 QR:         /api/qr\n`);
    });
  } catch (err) {
    console.error('❌ MySQL connection error:', err.message);
    process.exit(1);
  }
}

start();
