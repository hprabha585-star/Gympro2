const express = require('express');
const router  = express.Router();
const { User } = require('../models');
const { verifyToken, adminOnly, superAdminOnly } = require('./auth');

// ══════════════════════════════════════════════════════════════
//  SUPERADMIN routes  —  only hprabha585@gmail.com
// ══════════════════════════════════════════════════════════════

router.get('/gyms', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const gyms = await User.findAll({
      where: { role: 'admin', isApproved: true },
      attributes: { exclude: ['password'] },
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

// ══════════════════════════════════════════════════════════════
//  GYM ADMIN routes  —  gym owner manages their staff
// ══════════════════════════════════════════════════════════════

router.get('/staff', verifyToken, adminOnly, async (req, res) => {
  try {
    const gymId = req.user.gymId || req.user.userId;
    const staff = await User.findAll({
      where: { gymId, role: 'staff' },
      attributes: { exclude: ['password'] },
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
    const gymId = admin.gymId || admin.id;

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
    await user.destroy();
    res.json({ message: `${user.name} deleted.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/all-gyms', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'superadmin')
      return res.status(403).json({ error: 'Super-admin only.' });
    const gyms = await User.findAll({
      where: { role: 'admin' },
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'DESC']]
    });
    res.json(gyms);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/users', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'DESC']]
    });
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
