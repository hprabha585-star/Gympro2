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

async function start() {
  try {
    await sequelize.authenticate();
    console.log('✅ MySQL Connected');

    // Creates tables if they don't exist yet. Safe to leave on Hostinger;
    // it will NOT drop or overwrite existing tables/data.
    // { alter: true } lets sync() add new columns to EXISTING tables too
    // (plain sync() only creates missing tables — it silently skips new
    // fields added to a model later, which caused the "Unknown column"
    // 500 errors after pendingAmount was added). Safe for additive changes;
    // it will not drop existing columns or data.
    await sequelize.sync({ alter: true });
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
