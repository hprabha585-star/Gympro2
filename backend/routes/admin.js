const express = require('express');
const router  = express.Router();
const { User, Gym, Member, Trainer, Attendance } = require('../models');
const { verifyToken, adminOnly, superAdminOnly } = require('./auth');

// ══════════════════════════════════════════════════════════════
//  SUPERADMIN routes
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
    const gymIdParam = String(req.params.gymId);

    // Differentiate additional gyms vs primary gyms
    if (gymIdParam.startsWith('g_')) {
      const id = gymIdParam.replace('g_', '');
      const gym = await Gym.findByPk(id);
      if (!gym) return res.status(404).json({ error: 'Gym not found.' });

      await Attendance.destroy({ where: { userId: gym.id } });
      await Member.destroy({ where: { userId: gym.id } });
      await Trainer.destroy({ where: { userId: gym.id } });
      await gym.destroy();

      return res.json({ message: `${gym.name} removed.` });
    } else {
      const gym = await User.findOne({ where: { id: gymIdParam, role: 'admin' } });
      if (!gym) return res.status(404).json({ error: 'Gym account not found.' });

      await Attendance.destroy({ where: { userId: gym.id } });
      await Member.destroy({ where: { userId: gym.id } });
      await Trainer.destroy({ where: { userId: gym.id } });
      await User.destroy({ where: { gymId: gym.id, role: 'staff' } });
      await gym.destroy();

      return res.json({ message: `${gym.gymName || gym.name} removed.` });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/gym/:gymId/toggle', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const gymIdParam = String(req.params.gymId);

    if (gymIdParam.startsWith('g_')) {
      return res.status(400).json({ error: 'Suspending additional gyms is not supported.' });
    } else {
      const gym = await User.findOne({ where: { id: gymIdParam, role: 'admin' } });
      if (!gym) return res.status(404).json({ error: 'Gym not found.' });
      gym.isActive = !gym.isActive;
      await gym.save();
      return res.json({ message: `${gym.gymName || gym.name} is now ${gym.isActive ? 'active' : 'suspended'}.`, isActive: gym.isActive });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/gym/:gymId/member-limit', verifyToken, superAdminOnly, async (req, res) => {
  try {
    const gymIdParam = String(req.params.gymId);
    const { limit } = req.body; 
    const limitVal = (limit === null || limit === undefined || limit === '' || Number(limit) <= 0) ? null : Math.floor(Number(limit));

    if (gymIdParam.startsWith('g_')) {
      const id = gymIdParam.replace('g_', '');
      const gym = await Gym.findByPk(id);
      if (!gym) return res.status(404).json({ error: 'Gym not found.' });
      gym.memberLimit = limitVal;
      await gym.save();
      return res.json({
        message: gym.memberLimit ? `${gym.name} member limit set to ${gym.memberLimit}.` : `${gym.name} member limit removed.`,
        memberLimit: gym.memberLimit
      });
    } else {
      const gym = await User.findOne({ where: { id: gymIdParam, role: 'admin' } });
      if (!gym) return res.status(404).json({ error: 'Gym not found.' });
      gym.memberLimit = limitVal;
      await gym.save();
      return res.json({
        message: gym.memberLimit ? `${gym.gymName || gym.name} member limit set to ${gym.memberLimit}.` : `${gym.gymName || gym.name} member limit removed.`,
        memberLimit: gym.memberLimit
      });
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
//  GYM ADMIN routes
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
      return res.status(400).json({ error: 'Superadmin does not manage staff.' });

    const { name, email, password, permissions } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email and password are required.' });

    const emailLower = email.toLowerCase().trim();
    const existing = await User.findOne({ where: { email: emailLower } });
    if (existing) return res.status(400).json({ error: 'Email already registered.' });

    const admin = await User.findByPk(req.user.userId);
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

    const gymId = Number(req.user.gymId || req.user.userId);
    if (user.role !== 'staff' || Number(user.gymId) !== gymId)
      return res.status(403).json({ error: 'Not your staff member.' });

    await user.destroy();
    res.json({ message: `${user.name} deleted.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/all-gyms', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'Super-admin only.' });
    
    // Combine Primary and Additional Gyms for Superadmin Control Panel
    const primaryGyms = await User.findAll({
      where: { role: 'admin', isApproved: true },
      attributes: { exclude: ['password'] }
    });

    const additionalGyms = await Gym.findAll({
      where: { isApproved: true },
      include: [{ model: User, attributes: ['name', 'email'] }]
    });

    const list = [
      ...primaryGyms.map(u => ({
        _id: String(u.id),
        isPrimary: true,
        gymName: u.gymName || u.name,
        ownerName: u.name,
        email: u.email,
        isActive: u.isActive,
        memberLimit: u.memberLimit,
        createdAt: u.createdAt
      })),
      ...additionalGyms.map(g => ({
        _id: `g_${g.id}`,
        isPrimary: false,
        gymName: g.name,
        ownerName: g.User ? g.User.name : 'Unknown',
        email: g.User ? g.User.email : 'Unknown',
        isActive: true, 
        memberLimit: g.memberLimit,
        createdAt: g.createdAt
      }))
    ];

    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(list);
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

// ── Staff password reset ─────────────
router.get('/pending-staff-password-resets', verifyToken, adminOnly, async (req, res) => {
  try {
    const gymId = req.user.gymId || req.user.userId;
    const list = await User.findAll({
      where: { role: 'staff', gymId, resetRequested: true },
      attributes: { exclude: ['password'] },
      order: [['resetRequestedAt', 'DESC']]
    });
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/approve-staff-password-reset/:userId', verifyToken, adminOnly, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });

    const gymId = Number(req.user.gymId || req.user.userId);
    const staff = await User.findByPk(req.params.userId);
    if (!staff || staff.role !== 'staff' || Number(staff.gymId) !== gymId)
      return res.status(403).json({ error: 'Not your staff member.' });

    staff.password = newPassword; 
    staff.resetRequested = false;
    staff.resetRequestedAt = null;
    await staff.save();

    res.json({ message: `Password reset for ${staff.name}.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reject-staff-password-reset/:userId', verifyToken, adminOnly, async (req, res) => {
  try {
    const gymId = Number(req.user.gymId || req.user.userId);
    const staff = await User.findByPk(req.params.userId);
    if (!staff || staff.role !== 'staff' || Number(staff.gymId) !== gymId)
      return res.status(403).json({ error: 'Not your staff member.' });

    staff.resetRequested = false;
    staff.resetRequestedAt = null;
    await staff.save();
    res.json({ message: `Reset request for ${staff.name} dismissed.` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
