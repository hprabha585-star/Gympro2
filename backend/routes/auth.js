const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const { User, Gym, Member, Trainer, Attendance } = require('../models');
const { body, validationResult } = require('express-validator');

const JWT_SECRET  = process.env.JWT_SECRET || 'gympro_secret_key_2024';
const JWT_EXPIRES = '7d';

/* ─── helpers ────────────────────────────────────────────────── */
const verifyToken = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided.' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token.' }); }
};

const adminOnly = (req, res, next) => {
  if (!['admin', 'superadmin'].includes(req.user.role))
    return res.status(403).json({ error: 'Admin access only.' });
  next();
};

const superAdminOnly = (req, res, next) => {
  if (req.user.role !== 'superadmin')
    return res.status(403).json({ error: 'Super-admin only.' });
  next();
};

function makeToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role,
      gymId: user.gymId || user.id, permissions: user.staffPermissions || {} },
    JWT_SECRET, { expiresIn: JWT_EXPIRES }
  );
}

function makeTokenForGym(user, gymId, gymName) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role,
      gymId, gymName, permissions: user.staffPermissions || {} },
    JWT_SECRET, { expiresIn: JWT_EXPIRES }
  );
}

/* ─── POST /register  (gym admin registers — awaits superadmin approval) ─ */
router.post('/register', [
  body('name').notEmpty(),
  body('email').isEmail(),
  body('password').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, email, password, gymName } = req.body;

    if (email.toLowerCase() === 'hprabha585@gmail.com')
      return res.status(400).json({ error: 'This email cannot be used for registration.' });

    const existing = await User.findOne({ where: { email } });
    if (existing) return res.status(400).json({
      error: existing.isApproved ? 'Email already registered.' : 'Registration already submitted. Awaiting approval.'
    });

    const user = await User.create({
      name, email, password, gymName: gymName || '',
      role: 'admin', isApproved: false, pendingApproval: true, isActive: true
    });

    res.status(201).json({ message: 'Registration submitted. Awaiting GymPro approval.', pendingApproval: true });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─── POST /register-staff  (staff registers by entering admin email) ─── */
router.post('/register-staff', [
  body('name').notEmpty().withMessage('Name required'),
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password min 6 chars'),
  body('adminEmail').isEmail().withMessage('Valid admin email required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { name, email, password, adminEmail } = req.body;

    const admin = await User.findOne({
      where: { email: adminEmail.toLowerCase(), role: 'admin', isApproved: true, isActive: true }
    });
    if (!admin) return res.status(404).json({ error: 'No approved gym found with that email. Check the admin email and try again.' });

    const existing = await User.findOne({ where: { email } });
    if (existing) return res.status(400).json({ error: 'This email is already registered.' });

    await User.create({
      name, email, password,
      role: 'staff',
      gymId: admin.gymId || admin.id,
      isApproved: false,
      pendingApproval: true,
      isActive: false,
      staffPermissions: {
        viewMembers: true, addMembers: true, editMembers: true, deleteMembers: false,
        viewAttendance: true, markAttendance: true, viewTrainers: true,
        viewPayments: true, viewRevenue: false, viewSettings: false
      }
    });

    res.status(201).json({
      message: `Request sent to ${admin.gymName || admin.name}. Please wait for admin approval.`,
      pendingApproval: true
    });
  } catch (err) {
    console.error('Staff register error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─── POST /register-superadmin ── */
router.post('/register-superadmin', [
  body('name').notEmpty(),
  body('email').isEmail(),
  body('password').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { name, email, password } = req.body;
    const emailLower = email.toLowerCase().trim();

    const existing = await User.findOne({ where: { email: emailLower } });
    if (existing) return res.status(400).json({
      error: existing.isApproved ? 'Email already registered.' : 'A request for this email is already pending approval.'
    });

    await User.create({
      name, email: emailLower, password,
      role: 'superadmin', isApproved: false, pendingApproval: true, isActive: true
    });

    res.status(201).json({
      message: 'Request submitted. This account cannot log in until it is approved directly in the database by the site owner.'
    });
  } catch (err) {
    console.error('Superadmin registration error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─── POST /login ─────────────────────────────────────────────── */
router.post('/login', [
  body('email').isEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { email, password } = req.body;
    const user = await User.findOne({ where: { email } });
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

    if (!user.isApproved) {
      if (user.pendingApproval) return res.status(401).json({ error: 'Account pending approval. Please wait.' });
      return res.status(401).json({ error: `Account rejected: ${user.rejectionReason || 'Contact admin.'}` });
    }
    if (!user.isActive) return res.status(401).json({ error: 'Account deactivated. Contact your admin.' });

    const ok = await user.comparePassword(password);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password.' });

    user.lastLogin = new Date();
    await user.save();

    res.json({
      message: 'Login successful',
      token: makeToken(user),
      user: {
        id: user.id, name: user.name, email: user.email,
        role: user.role, gymId: user.gymId || user.id,
        gymName: user.gymName || '', permissions: user.staffPermissions || {}
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─── GET /me ─────────────────────────────────────────────────── */
router.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.userId, { attributes: { exclude: ['password'] } });
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─── GET /pending-approvals  (superadmin: pending gym owners) ── */
router.get('/pending-approvals', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const list = await User.findAll({
      where: { role: 'admin', isApproved: false, pendingApproval: true },
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'DESC']]
    });
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─── GET /pending-staff  (admin: pending staff requests for their gym) ─ */
router.get('/pending-staff', verifyToken, adminOnly, async (req, res) => {
  try {
    const gymId = req.user.gymId || req.user.userId;
    const list = await User.findAll({
      where: { role: 'staff', gymId, isApproved: false, pendingApproval: true },
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'DESC']]
    });
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─── POST /approve/:userId  (superadmin approves gym admin) ──── */
router.post('/approve/:userId', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    user.isApproved = true;
    user.pendingApproval = false;
    user.isActive = true;
    user.approvedBy = req.user.userId;
    user.approvedAt = new Date();
    user.rejectionReason = '';
    if (!user.gymId) user.gymId = user.id;

    if (req.body.memberLimit !== undefined) {
      const lim = req.body.memberLimit;
      user.memberLimit = (lim === null || lim === '' || Number(lim) <= 0) ? null : Math.floor(Number(lim));
    }

    await user.save();

    res.json({ message: `${user.gymName || user.name} approved.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─── POST /approve-staff/:userId  (admin approves staff request) */
router.post('/approve-staff/:userId', verifyToken, adminOnly, async (req, res) => {
  try {
    const staff = await User.findByPk(req.params.userId);
    if (!staff || staff.role !== 'staff') return res.status(404).json({ error: 'Staff not found.' });

    const gymId = Number(req.user.gymId || req.user.userId);
    if (Number(staff.gymId) !== gymId) return res.status(403).json({ error: 'Not your staff request.' });

    staff.isApproved = true;
    staff.pendingApproval = false;
    staff.isActive = true;
    staff.approvedBy = req.user.userId;
    staff.approvedAt = new Date();
    staff.rejectionReason = '';
    await staff.save();

    res.json({ message: `${staff.name} approved as staff.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─── POST /reject/:userId  (superadmin rejects gym admin) ────── */
router.post('/reject/:userId', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    user.isApproved = false; user.pendingApproval = false;
    user.isActive = false; user.rejectionReason = req.body.reason || 'Not approved.';
    await user.save();
    res.json({ message: `${user.name} rejected.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─── POST /reject-staff/:userId  (admin rejects staff request) ─ */
router.post('/reject-staff/:userId', verifyToken, adminOnly, async (req, res) => {
  try {
    const staff = await User.findByPk(req.params.userId);
    if (!staff || staff.role !== 'staff') return res.status(404).json({ error: 'Staff not found.' });

    const gymId = Number(req.user.gymId || req.user.userId);
    if (Number(staff.gymId) !== gymId) return res.status(403).json({ error: 'Not your staff request.' });

    staff.isApproved = false; staff.pendingApproval = false;
    staff.isActive = false; staff.rejectionReason = req.body.reason || 'Not approved.';
    await staff.save();
    res.json({ message: `${staff.name} rejected.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─── POST /logout ───────────────────────────────────────────── */
router.post('/logout', verifyToken, (req, res) => res.json({ message: 'Logged out.' }));

/* ─── GET /gym-profile ───────────────────────────────────────── */
router.get('/gym-profile', verifyToken, async (req, res) => {
  try {
    const activeId = req.user.gymId || req.user.userId;
    
    // Check if viewing primary gym
    if (Number(activeId) === Number(req.user.userId)) {
      const owner = await User.findByPk(activeId, { attributes: ['gymData', 'gymName', 'name'] });
      if (!owner) return res.status(404).json({ error: 'Primary gym profile not found.' });
      return res.json({ gymData: owner.gymData || '{}', gymName: owner.gymName || owner.name || '' });
    } 
    // Check if viewing an isolated additional gym
    else {
      const gym = await Gym.findByPk(activeId, { attributes: ['gymData', 'name'] });
      if (!gym) return res.status(404).json({ error: 'Additional gym profile not found.' });
      return res.json({ gymData: gym.gymData || '{}', gymName: gym.name || '' });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─── PATCH /profile ─────────────────────────────────────────── */
router.patch('/profile', verifyToken, async (req, res) => {
  try {
    const activeId = req.user.gymId || req.user.userId;
    
    if (Number(activeId) === Number(req.user.userId)) {
      const owner = await User.findByPk(activeId);
      if (!owner) return res.status(404).json({ error: 'Primary gym profile not found.' });
      if (req.body.gymData !== undefined) owner.gymData = req.body.gymData;
      if (req.body.gymName !== undefined) owner.gymName = req.body.gymName;
      await owner.save();
      return res.json({ message: 'Profile updated.' });
    } else {
      const gym = await Gym.findByPk(activeId);
      if (!gym) return res.status(404).json({ error: 'Additional gym profile not found.' });
      if (req.body.gymData !== undefined) gym.gymData = req.body.gymData;
      if (req.body.gymName !== undefined) gym.name = req.body.gymName;
      await gym.save();
      return res.json({ message: 'Profile updated.' });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ══════════════════════════════════════════════════════════════
   MULTI-GYM SUPPORT
══════════════════════════════════════════════════════════════ */

/* ─── GET /my-gyms — list every gym this owner has (primary + extras) ─── */
router.get('/my-gyms', verifyToken, adminOnly, async (req, res) => {
  try {
    if (req.user.role === 'superadmin')
      return res.status(400).json({ error: 'Superadmin does not own gyms.' });

    const ownerId = req.user.userId;
    const owner = await User.findByPk(ownerId);
    if (!owner) return res.status(404).json({ error: 'Account not found.' });

    const extraGyms = await Gym.findAll({ where: { ownerId }, order: [['createdAt', 'ASC']] });

    const list = [
      {
        id: owner.id,
        _id: String(owner.id),
        name: owner.gymName || owner.name || 'My Gym',
        isPrimary: true,
        isApproved: true,
        pendingApproval: false,
        current: Number(req.user.gymId) === owner.id
      },
      ...extraGyms.map(g => ({
        id: g.id,
        _id: String(g.id),
        name: g.name,
        isPrimary: false,
        isApproved: g.isApproved,
        pendingApproval: g.pendingApproval,
        rejectionReason: g.rejectionReason,
        current: Number(req.user.gymId) === g.id
      }))
    ];

    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─── POST /add-gym — request a new gym; needs superadmin approval ──── */
router.post('/add-gym', verifyToken, adminOnly, async (req, res) => {
  try {
    if (req.user.role === 'superadmin')
      return res.status(400).json({ error: 'Superadmin does not own gyms.' });

    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Gym name is required.' });

    const gym = await Gym.create({
      ownerId: req.user.userId,
      name: name.trim(),
      isApproved: false,
      pendingApproval: true
    });

    res.status(201).json({
      message: `"${gym.name}" submitted — waiting for GymPro approval before you can switch to it.`,
      gym
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─── POST /switch-gym — change which gym is "active", no re-login ──── */
router.post('/switch-gym', verifyToken, adminOnly, async (req, res) => {
  try {
    if (req.user.role === 'superadmin')
      return res.status(400).json({ error: 'Superadmin does not switch gyms.' });

    const { gymId } = req.body;
    if (!gymId) return res.status(400).json({ error: 'gymId is required.' });

    const owner = await User.findByPk(req.user.userId);
    if (!owner) return res.status(404).json({ error: 'Account not found.' });

    if (Number(gymId) === owner.id) {
      const token = makeTokenForGym(owner, owner.id, owner.gymName || owner.name);
      return res.json({ message: `Switched to ${owner.gymName || owner.name}.`, token, gymName: owner.gymName || owner.name });
    }

    const gym = await Gym.findOne({ where: { id: gymId, ownerId: owner.id } });
    if (!gym) return res.status(404).json({ error: 'Gym not found or not yours.' });
    if (!gym.isApproved) return res.status(403).json({ error: `"${gym.name}" is still pending superadmin approval.` });

    const token = makeTokenForGym(owner, gym.id, gym.name);
    res.json({ message: `Switched to ${gym.name}.`, token, gymName: gym.name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─── DELETE /my-gym/:id — admin deletes their own additional gym ──── */
router.delete('/my-gym/:id', verifyToken, adminOnly, async (req, res) => {
  try {
    if (req.user.role === 'superadmin') return res.status(400).json({ error: 'Superadmin does not own gyms.' });

    // Cannot delete the primary User account from this gym switcher
    if (Number(req.params.id) === Number(req.user.userId)) {
      return res.status(400).json({ error: 'Cannot delete your primary gym here. Contact GymPro support to delete your entire account.' });
    }

    const gym = await Gym.findOne({ where: { id: req.params.id, ownerId: req.user.userId } });
    if (!gym) return res.status(404).json({ error: 'Gym not found or not yours.' });

    await Attendance.destroy({ where: { userId: gym.id } });
    await Member.destroy({ where: { userId: gym.id } });
    await Trainer.destroy({ where: { userId: gym.id } });

    await gym.destroy();
    res.json({ message: `"${gym.name}" has been permanently deleted.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ─── POST /create-superadmin ── */
router.post('/create-superadmin', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password || password.length < 6)
      return res.status(400).json({ error: 'Name, email, and a password (6+ chars) are required.' });

    const emailLower = email.toLowerCase().trim();
    const existing = await User.findOne({ where: { email: emailLower } });
    if (existing) return res.status(400).json({ error: 'That email is already registered.' });

    const newSuperadmin = await User.create({
      name, email: emailLower, password,
      role: 'superadmin', isApproved: false, pendingApproval: true, isActive: true
    });

    res.status(201).json({
      message: `Request submitted for ${name}. This account must be approved directly in the database.`,
      user: { id: newSuperadmin.id, name: newSuperadmin.name, email: newSuperadmin.email }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ══════════════════════════════════════════════════════════════
   PASSWORD RESET
══════════════════════════════════════════════════════════════ */
router.post('/request-password-reset', [
  body('email').isEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Please enter a valid email.' });

    const email = req.body.email.toLowerCase().trim();
    const user = await User.findOne({ where: { email } });
    if (!user) return res.status(404).json({ error: 'No account found with that email.' });
    if (user.role === 'superadmin')
      return res.status(400).json({ error: 'Super-admin passwords are reset directly in the database.' });

    user.resetRequested = true;
    user.resetRequestedAt = new Date();
    await user.save();

    const approver = user.role === 'admin' ? 'GymPro (super-admin)' : 'your gym admin';
    res.json({ message: `Request submitted. ${approver} will review it.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/pending-password-resets', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const list = await User.findAll({
      where: { role: 'admin', resetRequested: true },
      attributes: { exclude: ['password'] },
      order: [['resetRequestedAt', 'DESC']]
    });
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/approve-password-reset/:userId', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });

    const user = await User.findByPk(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    user.password = newPassword; 
    user.resetRequested = false;
    user.resetRequestedAt = null;
    await user.save();

    res.json({ message: `Password reset for ${user.gymName || user.name}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reject-password-reset/:userId', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    user.resetRequested = false;
    user.resetRequestedAt = null;
    await user.save();
    res.json({ message: `Reset request for ${user.name} dismissed.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router, verifyToken, adminOnly, superAdminOnly };
