const express = require('express');
const router = express.Router();
const { Attendance } = require('../models');
const authMiddleware = require('../middleware/auth');

router.use(authMiddleware);

// GET attendance
router.get('/', async (req, res) => {
  try {
    const userId = req.user.gymId || req.user.userId;
    const data = await Attendance.findAll({
      where: { userId },
      include: [{ association: 'member' }]
    });
    // Reshape to mimic old .populate('memberId')
    const result = data.map(a => {
      const obj = a.toJSON();
      obj.memberId = obj.member || obj.memberId;
      delete obj.member;
      return obj;
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// MARK attendance (upsert, same logic as before)
router.post('/', async (req, res) => {
  try {
    const { memberId, status, date } = req.body;
    const userId = req.user.gymId || req.user.userId;

    if (!userId) return res.status(400).json({ error: 'Authentication token missing User ID' });
    if (!memberId || !status || !date) return res.status(400).json({ error: 'Missing required attendance fields' });

    let attendance = await Attendance.findOne({ where: { userId, memberId, date } });

    if (attendance) {
      attendance.status = status;
      attendance.markedAt = new Date();
      await attendance.save();
    } else {
      attendance = await Attendance.create({ userId, memberId, date, status });
    }

    res.status(200).json(attendance);
  } catch (err) {
    console.error('Attendance Save Error:', err);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
