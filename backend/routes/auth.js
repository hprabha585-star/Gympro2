const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User, Gym } = require('../models');

const JWT_SECRET = process.env.JWT_SECRET || 'gympro_secret_key_2024';
const TOKEN_EXPIRY = '30d';

// gymId in the token = the ACTIVE data-scope (own id, an additional Gym's
// id, or — for staff — their admin's id). userId = the real logged-in
// account and NEVER changes when an owner switches between their gyms.
function signToken(user, activeGymId) {
  return jwt.sign(
    {
      userId: user.id,
      gymId: activeGymId != null ? activeGymId : (user.gymId || user.id),
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

function verifyToken(req, res, next) {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'superadmin')
    return res.status(403).json({ error: 'Admin access only.' });
  next();
}

function superAdminOnly(req, res, next) {
  if (req.user.role !== 'superadmin')
    return res.status(403).json({ error: 'Super-admin access only.' });
  next();
}

const SAFE_EXCLUDE = ['password', 'pendingPasswordHash'];

// ── Per-gym settings isolation ──────────────────────────────────
// A "gym scope id" is either a primary owner's User.id or an additional
// gym's Gym.id (these never collide — see server.js's AUTO_INCREMENT
// offset). These helpers make sure Plans/Discounts/UPI settings are read
// from and written to whichever specific gym is CURRENTLY ACTIVE, never
// silently falling back to the owner's primary gym.
async function loadScopeSettings(scopeId) {
  const owner = await User.findByPk(scopeId);
  if (owner) return owner.gymData || '{}';
  const gym = await Gym.findByPk(scopeId);
  if (gym) return gym.gymData || '{}';
  return '{}';
}

async function saveScopeSettings(scopeId, gymData) {
  const owner = await User.findByPk(scopeId);
  if (owner) { owner.gymData = gymData; await owner.save({ hooks: false }); return true; }
  const gym = await Gym.findByPk(scopeId);
  if (gym) { gym.gymData = gymData; await gym.save(); return true; }
  return false;
}

// ══════════════════════════════════════════════════════════════
// LOGIN
// ══════════════════════════════════════════════════════════════
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    if (!user) return res.status(400).json({ error: 'Invalid email or password.' });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(400).json({ error: 'Invalid email or password.' });

    if (!user.isActive) return res.status(403).json({ error: 'This account has been deactivated. Contact your gym admin.' });
    if (user.pendingApproval || !user.isApproved) return res.status(403).json({ error: 'Your account is still pending approval.' });

    user.lastLogin = new Date();
    await user.save({ hooks: false });

    const token = signToken(user);
    const publicUser = user.toJSON();
    SAFE_EXCLUDE.forEach(k => delete publicUser[k]);
    res.json({ token, user: publicUser });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// REGISTER — Gym Admin (owner) — pending superadmin approval
// ══════════════════════════════════════════════════════════════
router.post('/register', async (req, res) => {
  try {
    const { name, gymName, email, password } = req.body;
    if (!name || !gymName || !email || !password) return res.status(400).json({ error: 'All fields are required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const emailLower = email.toLowerCase().trim();
    if (await User.findOne({ where: { email: emailLower } })) return res.status(400).json({ error: 'Email already registered.' });

    await User.create({ name, gymName, email: emailLower, password, role: 'admin', isApproved: false, pendingApproval: true, isActive: true });
    res.status(201).json({ pendingApproval: true, message: 'Registration submitted for approval.' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// REGISTER — Super Admin request (manual DB approval — see SUPERADMIN_SETUP.md)
// ══════════════════════════════════════════════════════════════
router.post('/register-superadmin', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'All fields are required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const emailLower = email.toLowerCase().trim();
    if (await User.findOne({ where: { email: emailLower } })) return res.status(400).json({ error: 'Email already registered.' });

    await User.create({ name, email: emailLower, password, role: 'superadmin', isApproved: false, pendingApproval: true, isActive: true });
    res.status(201).json({ message: 'Request submitted — requires manual database approval.' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// REGISTER — Staff — pending THEIR gym admin's approval
// ══════════════════════════════════════════════════════════════
router.post('/register-staff', async (req, res) => {
  try {
    const { name, adminEmail, email, password, gymBranch } = req.body;
    if (!name || !adminEmail || !email || !password) return res.status(400).json({ error: 'All fields are required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const admin = await User.findOne({ where: { email: adminEmail.toLowerCase().trim(), role: 'admin' } });
    if (!admin) return res.status(404).json({ error: 'No gym admin found with that email.' });

    const emailLower = email.toLowerCase().trim();
    if (await User.findOne({ where: { email: emailLower } })) return res.status(400).json({ error: 'Email already registered.' });

    // Which SPECIFIC gym does this staff member belong to? Defaults to the
    // owner's primary gym. If a branch name is given, it must match one of
    // that owner's approved additional gyms — staff and their approvals
    // stay entirely separate per gym, so this has to be exact.
    let targetGymId = admin.id;
    const branch = (gymBranch || '').trim();
    if (branch && !['main', 'primary', (admin.gymName || '').trim().toLowerCase()].includes(branch.toLowerCase())) {
      const match = await Gym.findOne({ where: { ownerId: admin.id, isApproved: true, name: branch } });
      if (!match) {
        return res.status(404).json({ error: `No approved gym branch named "${branch}" found for this admin. Leave it blank for the main gym, or check the exact spelling with your admin.` });
      }
      targetGymId = match.id;
    }

    await User.create({ name, email: emailLower, password, role: 'staff', gymId: targetGymId, isApproved: false, pendingApproval: true, isActive: true });
    res.status(201).json({ message: 'Request sent to your gym admin for approval.' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// SUPERADMIN — approve / reject gym-admin registrations
// ══════════════════════════════════════════════════════════════
router.get('/pending-approvals', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const list = await User.findAll({
      where: { role: 'admin', pendingApproval: true, isApproved: false },
      attributes: { exclude: SAFE_EXCLUDE },
      order: [['createdAt', 'DESC']]
    });
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/approve/:userId', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.userId);
    if (!user || user.role !== 'admin') return res.status(404).json({ error: 'Registration not found.' });

    const approver = await User.findByPk(req.user.userId);
    user.isApproved = true;
    user.pendingApproval = false;
    user.rejectionReason = '';
    user.approvedBy = req.user.userId;
    user.approvedByName = approver?.name || '';
    user.approvedAt = new Date();
    if (req.body.memberLimit !== undefined) {
      const lim = req.body.memberLimit;
      user.memberLimit = (lim === null || lim === '' || Number(lim) <= 0) ? null : Math.floor(Number(lim));
    }
    await user.save({ hooks: false });
    res.json({ message: `${user.gymName || user.name} approved.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reject/:userId', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.userId);
    if (!user || user.role !== 'admin') return res.status(404).json({ error: 'Registration not found.' });
    user.isApproved = false;
    user.pendingApproval = false;
    user.rejectionReason = req.body.reason || 'Not approved.';
    await user.save({ hooks: false });
    res.json({ message: 'Registration rejected.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// GYM ADMIN — approve / reject their own staff registrations
// ══════════════════════════════════════════════════════════════
router.get('/pending-staff', verifyToken, adminOnly, async (req, res) => {
  try {
    const gymId = Number(req.user.gymId || req.user.userId);
    const list = await User.findAll({
      where: { role: 'staff', gymId, pendingApproval: true, isApproved: false },
      attributes: { exclude: SAFE_EXCLUDE },
      order: [['createdAt', 'DESC']]
    });
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/approve-staff/:staffId', verifyToken, adminOnly, async (req, res) => {
  try {
    const gymId = Number(req.user.gymId || req.user.userId);
    const staff = await User.findByPk(req.params.staffId);
    if (!staff || staff.role !== 'staff' || Number(staff.gymId) !== gymId)
      return res.status(404).json({ error: 'Staff request not found for this gym.' });

    const approver = await User.findByPk(req.user.userId);
    staff.isApproved = true;
    staff.pendingApproval = false;
    staff.rejectionReason = '';
    staff.approvedBy = req.user.userId;
    staff.approvedByName = approver?.name || '';
    staff.approvedAt = new Date();
    await staff.save({ hooks: false });
    res.json({ message: `${staff.name} approved.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reject-staff/:staffId', verifyToken, adminOnly, async (req, res) => {
  try {
    const gymId = Number(req.user.gymId || req.user.userId);
    const staff = await User.findByPk(req.params.staffId);
    if (!staff || staff.role !== 'staff' || Number(staff.gymId) !== gymId)
      return res.status(404).json({ error: 'Staff request not found for this gym.' });
    staff.isApproved = false;
    staff.pendingApproval = false;
    staff.rejectionReason = req.body.reason || 'Not approved.';
    await staff.save({ hooks: false });
    res.json({ message: `${staff.name} rejected.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// PROFILE  (gymData JSON blob: plans / discounts / UPI & fee config)
// ══════════════════════════════════════════════════════════════
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.userId, { attributes: { exclude: SAFE_EXCLUDE } });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Saves Plans/Discounts/UPI/fee settings for the CURRENTLY ACTIVE gym only
// (req.user.gymId) — never the owner's real/primary account — so each
// gym an owner manages keeps its own independent settings.
router.patch('/profile', verifyToken, async (req, res) => {
  try {
    if (req.body.gymData === undefined) return res.status(400).json({ error: 'gymData is required.' });
    const scopeId = Number(req.user.gymId || req.user.userId);
    const ok = await saveScopeSettings(scopeId, req.body.gymData);
    if (!ok) return res.status(404).json({ error: 'Active gym not found.' });
    res.json({ message: 'Saved.', gymData: req.body.gymData });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Returns settings for the CALLER'S ACTIVE gym scope. For staff this is
// always their own assigned gym (never the owner's other gyms); for an
// owner it's whichever gym they're currently switched into.
router.get('/gym-profile', verifyToken, async (req, res) => {
  try {
    const scopeId = Number(req.user.gymId || req.user.userId);
    const gymData = await loadScopeSettings(scopeId);
    res.json({ gymData });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// MULTI-GYM  —  list / add / switch
// ══════════════════════════════════════════════════════════════

// GET /auth/my-gyms — every gym this OWNER account has: their primary gym
// (their own User row) plus any additional gyms (rows in the Gym table).
router.get('/my-gyms', verifyToken, adminOnly, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only gym owners have multiple gyms.' });

    const ownerId = req.user.userId; // real account id — constant even while switched
    const owner = await User.findByPk(ownerId);
    if (!owner) return res.status(404).json({ error: 'Account not found.' });

    const activeGymId = Number(req.user.gymId || ownerId);

    const list = [{
      id: owner.id,
      name: owner.gymName || (owner.name + "'s Gym"),
      isPrimary: true,
      isApproved: true,
      pendingApproval: false,
      rejectionReason: '',
      current: activeGymId === owner.id
    }];

    const extras = await Gym.findAll({ where: { ownerId }, order: [['createdAt', 'ASC']] });
    extras.forEach(g => {
      list.push({
        id: g.id,
        name: g.name,
        isPrimary: false,
        isApproved: g.isApproved,
        pendingApproval: g.pendingApproval,
        rejectionReason: g.rejectionReason,
        current: activeGymId === g.id
      });
    });

    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /auth/add-gym — { name } — request an additional gym (needs superadmin approval)
router.post('/add-gym', verifyToken, adminOnly, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only gym owners can add gyms.' });

    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Gym name is required.' });

    await Gym.create({ ownerId: req.user.userId, name, isApproved: false, pendingApproval: true });
    res.status(201).json({ message: `"${name}" submitted for GymPro approval.` });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// POST /auth/switch-gym — { gymId } — change active data-scope, issue new token
router.post('/switch-gym', verifyToken, adminOnly, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only gym owners can switch gyms.' });

    const ownerId = req.user.userId;
    const targetId = Number(req.body.gymId);
    if (!targetId) return res.status(400).json({ error: 'gymId is required.' });

    const owner = await User.findByPk(ownerId);
    if (!owner) return res.status(404).json({ error: 'Account not found.' });

    let gymName;
    if (targetId === owner.id) {
      gymName = owner.gymName || (owner.name + "'s Gym");
    } else {
      const gym = await Gym.findOne({ where: { id: targetId, ownerId } });
      if (!gym) return res.status(404).json({ error: 'Gym not found.' });
      if (!gym.isApproved) return res.status(403).json({ error: 'This gym is not yet approved by GymPro.' });
      gymName = gym.name;
    }

    const token = signToken(owner, targetId);
    res.json({ token, gymName, message: `Switched to ${gymName}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// PASSWORD RESET — requires approval
//   admin's reset  → approved by superadmin
//   staff's reset  → approved by their gym admin
//   (superadmin's own password stays a manual DB operation — see
//    SUPERADMIN_SETUP.md — consistent with the existing security model)
// ══════════════════════════════════════════════════════════════
router.post('/request-password-reset', async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    if (!email || !newPassword) return res.status(400).json({ error: 'Email and new password are required.' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    if (!user) return res.status(404).json({ error: 'No account found with that email.' });

    if (user.role === 'superadmin')
      return res.status(400).json({ error: 'Super-admin passwords can only be reset directly in the database — see SUPERADMIN_SETUP.md.' });

    user.pendingPasswordHash = await bcrypt.hash(newPassword, 10);
    user.pendingPasswordRequestedAt = new Date();
    await user.save({ hooks: false }); // don't touch/re-hash the real (still active) password field

    const approver = user.role === 'admin' ? 'the GymPro team' : 'your gym admin';
    res.json({ message: `Password reset requested. Your current password still works until this is approved by ${approver}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Superadmin: view + approve/reject pending ADMIN password resets
router.get('/pending-password-resets', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const list = await User.findAll({
      where: { role: 'admin', pendingPasswordHash: { [Op.ne]: null } },
      attributes: { exclude: SAFE_EXCLUDE },
      order: [['pendingPasswordRequestedAt', 'DESC']]
    });
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/approve-password-reset/:userId', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.userId);
    if (!user || user.role !== 'admin' || !user.pendingPasswordHash)
      return res.status(404).json({ error: 'No pending password reset for this account.' });

    user.password = user.pendingPasswordHash; // already bcrypt-hashed
    user.pendingPasswordHash = null;
    user.pendingPasswordRequestedAt = null;
    await user.save({ hooks: false }); // hooks:false — must NOT re-hash an already-hashed value
    res.json({ message: `Password reset approved for ${user.gymName || user.name}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reject-password-reset/:userId', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.userId);
    if (!user || user.role !== 'admin') return res.status(404).json({ error: 'Account not found.' });
    user.pendingPasswordHash = null;
    user.pendingPasswordRequestedAt = null;
    await user.save({ hooks: false });
    res.json({ message: 'Password reset request rejected.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router, verifyToken, adminOnly, superAdminOnly };
