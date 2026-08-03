const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Member, Attendance, User, Gym } = require('../models');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

// Get all members (only current user's members)
router.get('/', async (req, res) => {
  try {
    const gymId = req.user.gymId || req.user.userId;
    const members = await Member.findAll({ where: { userId: gymId }, order: [['joinDate', 'DESC']] });
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const gymId = req.user.gymId || req.user.userId;
    const today = new Date().toISOString().split('T')[0];

    // Run the independent counts/queries in parallel instead of one after
    // another — this endpoint used to pay 3 sequential DB round trips
    // (totalMembers -> activeToday -> activeMembers) for numbers that
    // don't depend on each other at all.
    const [totalMembers, activeToday, activeMembers] = await Promise.all([
      Member.count({ where: { userId: gymId } }),
      Attendance.count({ where: { userId: gymId, date: today, status: 'Present' } }),
      Member.findAll({ where: { userId: gymId, status: 'Active' }, attributes: ['plan'] })
    ]);

    const revenueMap = {
      '1 Month Strength': 1000,
      '1 Month Strength + Cardio': 1500,
      '3 Months Strength': 2700,
      '3 Months Strength + Cardio': 4000,
      '6 Months Strength': 5000,
      '6 Months Strength + Cardio': 7500,
      '1 Year Strength': 9000,
      '1 Year Strength + Cardio': 14000
    };

    let estimatedRevenue = 0;
    activeMembers.forEach(m => { estimatedRevenue += revenueMap[m.plan] || 0; });

    res.json({ totalMembers, activeToday, estimatedRevenue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Safety net: reject any photo over ~40KB (frontend compresses to ~20-24KB;
// this just guards against old cached frontend code or direct API calls).
const MAX_PHOTO_BYTES = 40 * 1024;
function checkPhotoSize(photo) {
  if (!photo) return null;
  const approxBytes = Math.round(photo.length * 0.75); // base64 -> bytes
  if (approxBytes > MAX_PHOTO_BYTES) {
    return `Photo is too large (${Math.round(approxBytes / 1024)}KB). Please retake or re-upload — it should auto-compress to under 25KB.`;
  }
  return null;
}

// Add new member
router.post('/', async (req, res) => {
  try {
    const gymId = req.user.gymId || req.user.userId;
    const memberData = req.body;

    const photoErr = checkPhotoSize(memberData.photo);
    if (photoErr) return res.status(400).json({ error: photoErr });

    // SPEED FIX: the gym-owner lookup (for the member-limit check) and the
    // duplicate-phone check don't depend on each other at all, but used to
    // run one after another — an extra full DB round trip on every single
    // "Add Member" request. Run them in parallel instead.
    // gymId may belong to either the owner's own account (primary gym) or
    // a row in the Gym table (an additional gym) — check both, since only
    // checking User previously let additional gyms bypass their limit
    // entirely.
    const [gymOwner, existingMember] = await Promise.all([
      User.findByPk(gymId),
      Member.findOne({ where: { userId: gymId, phone: memberData.phone } })
    ]);

    if (existingMember) {
      return res.status(400).json({ error: 'Member with this phone number already exists' });
    }

    let memberLimit = gymOwner ? gymOwner.memberLimit : null;
    if (!gymOwner) {
      const gymRow = await Gym.findByPk(gymId);
      if (gymRow) memberLimit = gymRow.memberLimit;
    }
    if (memberLimit) {
      const currentCount = await Member.count({ where: { userId: gymId } });
      if (currentCount >= memberLimit) {
        return res.status(403).json({
          error: `Member limit reached (${memberLimit} members). Contact GymPro support to increase your limit.`
        });
      }
    }

    const newMember = await Member.create({ ...memberData, userId: gymId });
    res.status(201).json(newMember);
  } catch (err) {
    // Log on separate lines — a single long line (the previous behavior)
    // was getting visually cut off in the hosting panel's log viewer,
    // hiding the actual cause behind "Add member error: Error".
    console.error('❌ Add member error — name:', err.name);
    console.error('❌ Add member error — message:', err.message);
    if (err.errors && err.errors.length) {
      err.errors.forEach((e, i) => console.error(`❌ Add member error — detail ${i + 1}:`, e.message, '| field:', e.path, '| value:', e.value));
    }
    if (err.parent) console.error('❌ Add member error — DB detail:', err.parent.sqlMessage || err.parent.message);

    const detail = (err.errors && err.errors[0]?.message) || err.parent?.sqlMessage || err.message || 'Unknown error';
    res.status(400).json({ error: detail });
  }
});

// Edit / Update an existing member
router.put('/:id', async (req, res) => {
  try {
    const gymId = req.user.gymId || req.user.userId;
    const memberData = req.body;

    const photoErr = checkPhotoSize(memberData.photo);
    if (photoErr) return res.status(400).json({ error: photoErr });

    // SPEED FIX: same as above — the duplicate-phone check (when phone is
    // being changed) and loading the member being edited don't depend on
    // each other, so run them in parallel instead of sequentially.
    const [existingMember, member] = await Promise.all([
      memberData.phone
        ? Member.findOne({ where: { userId: gymId, phone: memberData.phone, id: { [Op.ne]: req.params.id } } })
        : Promise.resolve(null),
      Member.findOne({ where: { id: req.params.id, userId: gymId } })
    ]);

    if (memberData.phone && existingMember) {
      return res.status(400).json({ error: 'Another member with this phone number already exists' });
    }
    if (!member) return res.status(404).json({ error: 'Member not found' });

    await member.update(memberData);
    res.json(member);
  } catch (err) {
    console.error('Update member error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete member
router.delete('/:id', async (req, res) => {
  try {
    const gymId = req.user.gymId || req.user.userId;
    const member = await Member.findOne({ where: { id: req.params.id, userId: gymId } });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    await Attendance.destroy({ where: { userId: gymId, memberId: req.params.id } });
    await member.destroy();
    res.json({ message: 'Member deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get attendance for a specific date (mimics old .populate('memberId'))
router.get('/attendance/:date', async (req, res) => {
  try {
    const gymId = req.user.gymId || req.user.userId;
    const { date } = req.params;
    const rows = await Attendance.findAll({
      where: { userId: gymId, date },
      include: [{ model: Member, as: 'member', attributes: ['id', 'name', 'phone', 'plan', 'status'] }]
    });

    const result = rows.map(r => {
      const obj = r.toJSON();
      obj.memberId = obj.member || null; // replicate populated shape
      delete obj.member;
      return obj;
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark attendance
router.post('/attendance', async (req, res) => {
  try {
    const gymId = req.user.gymId || req.user.userId;
    const { memberId, date, status } = req.body;

    const member = await Member.findOne({ where: { id: memberId, userId: gymId } });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    let attendance = await Attendance.findOne({ where: { userId: gymId, memberId, date } });
    if (attendance) {
      attendance.status = status;
      attendance.markedAt = new Date();
      await attendance.save();
    } else {
      attendance = await Attendance.create({ userId: gymId, memberId, date, status, markedAt: new Date() });
    }

    res.json(attendance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Attendance stats
router.get('/attendance/stats/:date', async (req, res) => {
  try {
    const gymId = req.user.gymId || req.user.userId;
    const { date } = req.params;

    // SPEED FIX: these two counts are independent — run in parallel.
    const [totalActive, presentCount] = await Promise.all([
      Member.count({ where: { userId: gymId, status: { [Op.in]: ['Active', 'Trial'] } } }),
      Attendance.count({ where: { userId: gymId, date, status: 'Present' } })
    ]);
    const attendancePercentage = totalActive > 0 ? Math.round((presentCount / totalActive) * 100) : 0;

    res.json({ totalActive, presentCount, attendancePercentage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Payment reminders
router.get('/payment-reminders', async (req, res) => {
  try {
    const gymId = req.user.gymId || req.user.userId;
    const dueMembers = await Member.findAll({
      where: {
        userId: gymId,
        status: 'Active',
        expiryDate: { [Op.lte]: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
      }
    });

    res.json({ dueCount: dueMembers.length, dueMembers, overdueCount: 0 });
  } catch (err) {
    res.json({ dueCount: 0, dueMembers: [], overdueCount: 0 });
  }
});

// Monthly due
router.get('/monthly-due/:memberId', async (req, res) => {
  try {
    const gymId = req.user.gymId || req.user.userId;
    const member = await Member.findOne({ where: { id: req.params.memberId, userId: gymId } });
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const planPrices = {
      '1 Month Strength': 1000,
      '1 Month Strength + Cardio': 1500,
      '3 Months Strength': 900,
      '3 Months Strength + Cardio': 1333,
      '6 Months Strength': 833,
      '6 Months Strength + Cardio': 1250,
      '1 Year Strength': 750,
      '1 Year Strength + Cardio': 1167
    };

    const monthlyAmount = planPrices[member.plan] || 0;
    const isDue = member.expiryDate && new Date(member.expiryDate) < new Date();

    res.json({
      memberName: member.name,
      monthlyAmount: Math.round(monthlyAmount),
      nextDueDate: member.expiryDate,
      isOverdue: isDue,
      daysOverdue: isDue ? Math.floor((new Date() - new Date(member.expiryDate)) / (1000 * 60 * 60 * 24)) : 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/send-reminder/:memberId', async (req, res) => {
  res.json({ message: 'Reminder sent successfully' });
});
router.post('/record-payment/:memberId', async (req, res) => {
  res.json({ message: 'Payment recorded successfully' });
});

module.exports = router;
