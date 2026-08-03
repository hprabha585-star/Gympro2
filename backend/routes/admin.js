const express = require('express');
const router  = express.Router();
const { Op } = require('sequelize');
const { User, Gym } = require('../models');
const { verifyToken, adminOnly, superAdminOnly } = require('./auth');

// ══════════════════════════════════════════════════════════════
//  SUPERADMIN routes  —  only hprabha585@gmail.com
// ══════════════════════════════════════════════════════════════

router.get('/gyms', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const gyms = await User.findAll({
      where: { role: 'admin', isApproved: true },
      attributes: { exclude: ['password', 'pendingPasswordHash'] },
      order: [['createdAt', 'DESC']]
    });
    res.json(gyms);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/all-gyms-stats', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const totalGyms   = await User.count({ where: { role: 'admin', isApproved: true } });
    const pendingGyms = await User.count({ where: { role: 'admin', isApproved: false, pendingApproval: true } });
    const totalStaff  = await User.count({ where: { role: 'staff' } });
    res.json({ totalGyms, pendingGyms, totalStaff });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/gym/:gymId', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const gym = await User.findOne({ where: { id: req.params.gymId, role: 'admin' } });
    if (!gym) return res.status(404).json({ error: 'Gym account not found.' });
    await User.destroy({ where: { gymId: gym.id, role: 'staff' } });
    await gym.destroy();
    res.json({ message: `${gym.gymName || gym.name} removed.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/gym/:gymId/toggle', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const gym = await User.findOne({ where: { id: req.params.gymId, role: 'admin' } });
    if (!gym) return res.status(404).json({ error: 'Gym not found.' });
    gym.isActive = !gym.isActive;
    await gym.save();
    res.json({ message: `${gym.gymName || gym.name} is now ${gym.isActive ? 'active' : 'suspended'}.`, isActive: gym.isActive });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /admin/gym/:gymId/member-limit — superadmin sets/changes a gym's member cap
router.patch('/gym/:gymId/member-limit', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const gym = await User.findOne({ where: { id: req.params.gymId, role: 'admin' } });
    if (!gym) return res.status(404).json({ error: 'Gym not found.' });

    const { limit } = req.body; // null/0/undefined => unlimited
    gym.memberLimit = (limit === null || limit === undefined || limit === '' || Number(limit) <= 0)
      ? null
      : Math.floor(Number(limit));
    await gym.save();

    res.json({
      message: gym.memberLimit
        ? `${gym.gymName || gym.name} member limit set to ${gym.memberLimit}.`
        : `${gym.gymName || gym.name} member limit removed (unlimited).`,
      memberLimit: gym.memberLimit
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Additional-gym approvals (an existing owner adding gym #2, #3, etc.) ──

// GET /admin/pending-gyms — additional gyms awaiting approval (not the
// original owner-account approvals, which stay under /auth/pending-approvals)
router.get('/pending-gyms', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const pending = await Gym.findAll({
      where: { isApproved: false, pendingApproval: true },
      include: [{ model: User, attributes: ['id', 'name', 'email', 'gymName'] }],
      order: [['createdAt', 'DESC']]
    });
    res.json(pending);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /admin/approve-gym/:gymId
router.post('/approve-gym/:gymId', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const gym = await Gym.findByPk(req.params.gymId);
    if (!gym) return res.status(404).json({ error: 'Gym request not found.' });
    gym.isApproved = true;
    gym.pendingApproval = false;
    gym.rejectionReason = '';
    gym.approvedAt = new Date();

    if (req.body.memberLimit !== undefined) {
      const lim = req.body.memberLimit;
      gym.memberLimit = (lim === null || lim === '' || Number(lim) <= 0) ? null : Math.floor(Number(lim));
    }

    await gym.save();
    res.json({ message: `"${gym.name}" approved — the owner can now switch to it.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /admin/reject-gym/:gymId
router.post('/reject-gym/:gymId', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const gym = await Gym.findByPk(req.params.gymId);
    if (!gym) return res.status(404).json({ error: 'Gym request not found.' });
    gym.isApproved = false;
    gym.pendingApproval = false;
    gym.rejectionReason = req.body.reason || 'Not approved.';
    await gym.save();
    res.json({ message: `"${gym.name}" rejected.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
//  GYM ADMIN routes  —  gym owner manages their staff
// ══════════════════════════════════════════════════════════════

router.get('/staff', verifyToken, adminOnly, async (req, res) => {
  try {
    const gymId = req.user.gymId || req.user.userId;
    const staff = await User.findAll({
      where: { gymId, role: 'staff' },
      attributes: { exclude: ['password', 'pendingPasswordHash'] },
      order: [['createdAt', 'DESC']]
    });
    res.json(staff);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/create-staff', verifyToken, adminOnly, async (req, res) => {
  try {
    if (req.user.role === 'superadmin')
      return res.status(400).json({ error: 'Superadmin does not manage staff. Use a gym admin account.' });

    const { name, email, password, permissions } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email and password are required.' });

    const emailLower = email.toLowerCase().trim();
    const existing = await User.findOne({ where: { email: emailLower } });
    if (existing) return res.status(400).json({ error: 'Email already registered.' });

    const admin = await User.findByPk(req.user.userId);
    // BUG FIX: previously always used admin.gymId||admin.id (the owner's
    // PRIMARY gym), ignoring which gym is actually active right now. If an
    // owner switched to an additional gym (via Manage Gym) and added staff
    // from there, the staff silently ended up attached to gym #1 instead —
    // invisible in the gym they were actually added under. req.user.gymId
    // reflects whichever gym is currently active in this session's token.
    const gymId = req.user.gymId || req.user.userId;

    const defaultPerms = {
      viewMembers: true, addMembers: true, editMembers: true, deleteMembers: false,
      viewAttendance: true, markAttendance: true, viewTrainers: true,
      viewPayments: true, viewRevenue: false, viewSettings: false
    };

    const staff = await User.create({
      name, email: emailLower, password,
      role: 'staff',
      gymId,
      isApproved: true,
      pendingApproval: false,
      isActive: true,
      approvedBy: req.user.userId,
      approvedByName: admin.name,
      approvedAt: new Date(),
      staffPermissions: { ...defaultPerms, ...(permissions || {}) }
    });

    res.status(201).json({
      message: `Staff account created for ${name}.`,
      staff: { id: staff.id, name: staff.name, email: staff.email }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/staff/:staffId/permissions', verifyToken, adminOnly, async (req, res) => {
  try {
    const gymId = Number(req.user.gymId || req.user.userId);
    const staff = await User.findByPk(req.params.staffId);
    if (!staff || staff.role !== 'staff')
      return res.status(404).json({ error: 'Staff not found.' });
    if (Number(staff.gymId) !== gymId)
      return res.status(403).json({ error: 'Not your staff member.' });

    staff.staffPermissions = { ...staff.staffPermissions, ...req.body };
    await staff.save();

    res.json({ message: 'Permissions updated.', permissions: staff.staffPermissions });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/user/:userId/toggle', verifyToken, adminOnly, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // BUG FIX: this route previously had NO ownership check at all — any
    // admin (or superadmin) could toggle ANY user by id, including another
    // gym's staff or even another gym's owner account. It's shared by two
    // legitimate callers — superadmin toggling a gym-owner account, and a
    // gym admin toggling their own staff — so branch on which one this is.
    if (req.user.role === 'superadmin') {
      if (user.role !== 'admin')
        return res.status(403).json({ error: 'Super-admin can only toggle gym-owner accounts here.' });
    } else {
      const gymId = Number(req.user.gymId || req.user.userId);
      if (user.role !== 'staff' || Number(user.gymId) !== gymId)
        return res.status(403).json({ error: 'Not your staff member.' });
    }

    user.isActive = !user.isActive;
    await user.save();
    res.json({ message: `${user.name} is now ${user.isActive ? 'active' : 'inactive'}.`, isActive: user.isActive });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/user/:userId', verifyToken, adminOnly, async (req, res) => {
  try {
    if (String(req.params.userId) === String(req.user.userId))
      return res.status(400).json({ error: 'Cannot delete your own account.' });
    const user = await User.findByPk(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // BUG FIX: same missing-ownership-check issue as the toggle route above
    // — any admin could previously delete any user by id, gym-crossing
    // included. A gym admin may only delete their own staff.
    if (req.user.role !== 'superadmin') {
      const gymId = Number(req.user.gymId || req.user.userId);
      if (user.role !== 'staff' || Number(user.gymId) !== gymId)
        return res.status(403).json({ error: 'Not your staff member.' });
    }

    await user.destroy();
    res.json({ message: `${user.name} deleted.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Staff password resets — the gym admin approves their own staff's requests ──

router.get('/pending-staff-password-resets', verifyToken, adminOnly, async (req, res) => {
  try {
    // BUG FIX: was hardcoded to req.user.userId (always the owner's primary
    // gym) — an owner switched into an additional gym would never see that
    // gym's own staff password-reset requests. Use the active gym instead.
    const gymId = req.user.gymId || req.user.userId;
    const list = await User.findAll({
      where: { role: 'staff', gymId, pendingPasswordHash: { [Op.ne]: null } },
      attributes: { exclude: ['password', 'pendingPasswordHash'] },
      order: [['pendingPasswordRequestedAt', 'DESC']]
    });
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/approve-staff-password-reset/:staffId', verifyToken, adminOnly, async (req, res) => {
  try {
    const gymId = Number(req.user.gymId || req.user.userId);
    const staff = await User.findByPk(req.params.staffId);
    if (!staff || staff.role !== 'staff' || Number(staff.gymId) !== gymId || !staff.pendingPasswordHash)
      return res.status(404).json({ error: 'No pending password reset for this staff member.' });

    staff.password = staff.pendingPasswordHash; // already bcrypt-hashed
    staff.pendingPasswordHash = null;
    staff.pendingPasswordRequestedAt = null;
    await staff.save({ hooks: false }); // must NOT re-hash an already-hashed value
    res.json({ message: `Password reset approved for ${staff.name}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reject-staff-password-reset/:staffId', verifyToken, adminOnly, async (req, res) => {
  try {
    const gymId = Number(req.user.gymId || req.user.userId);
    const staff = await User.findByPk(req.params.staffId);
    if (!staff || staff.role !== 'staff' || Number(staff.gymId) !== gymId)
      return res.status(404).json({ error: 'Staff member not found.' });
    staff.pendingPasswordHash = null;
    staff.pendingPasswordRequestedAt = null;
    await staff.save({ hooks: false });
    res.json({ message: 'Rejected.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/all-gyms', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'superadmin')
      return res.status(403).json({ error: 'Super-admin only.' });
    const gyms = await User.findAll({
      where: { role: 'admin' },
      attributes: { exclude: ['password', 'pendingPasswordHash'] },
      order: [['createdAt', 'DESC']]
    });
    res.json(gyms);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/users', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['password', 'pendingPasswordHash'] },
      order: [['createdAt', 'DESC']]
    });
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
