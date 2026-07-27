const express = require('express');
const router = express.Router();
const { Member, Attendance, User } = require('../models');
const { Op } = require('sequelize');
const authMiddleware = require('../middleware/auth');

// Generate GYM QR code (for the gym entrance)
router.get('/gym-qr', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.gymId || req.user.userId;

    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const qrData = {
      gymId: userId,
      gymName: user.name || 'GymPro',
      type: 'gym_checkin',
      timestamp: Date.now()
    };

    const encodedData = Buffer.from(JSON.stringify(qrData)).toString('base64');

    // ⚠️ Update this to your new domain once you move off Render
    const checkinUrl = `https://lightcoral-lemur-755075.hostingersite.com/member-checkin.html?qr=${encodeURIComponent(encodedData)}`;

    res.json({
      qrString: checkinUrl,
      qrData: encodedData,
      gymName: user.name,
      gymId: userId,
      checkinUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Member self check-in (public)
router.post('/member-checkin', async (req, res) => {
  try {
    const { qrData, memberId, phoneNumber } = req.body;
    if (!qrData) return res.status(400).json({ error: 'QR data required' });

    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(qrData, 'base64').toString());
    } catch (e) {
      return res.status(400).json({ error: 'Invalid QR code' });
    }

    if (decoded.type !== 'gym_checkin') {
      return res.status(400).json({ error: 'Invalid gym QR code' });
    }

    const { gymId } = decoded;

    let member;
    if (memberId) {
      // The number shown to members on their card is memberNo (e.g. "ID #1002"),
      // not the internal database id — match on memberNo first, fall back to id
      // so both the friendly displayed number and a raw id still work.
      member = await Member.findOne({ where: { memberNo: memberId, userId: gymId } });
      if (!member) {
        member = await Member.findOne({ where: { id: memberId, userId: gymId } });
      }
    } else if (phoneNumber) {
      const cleanPhone = String(phoneNumber).replace(/[^0-9]/g, '');
      member = await Member.findOne({ where: { phone: cleanPhone, userId: gymId } });
    }

    if (!member) {
      return res.status(404).json({ error: 'Member not found. Please check your Member ID or Phone number.' });
    }

    if (member.status !== 'Active' && member.status !== 'Trial') {
      return res.status(403).json({ error: 'Membership is not active. Please contact gym staff.' });
    }

    if (member.expiryDate) {
      const expiryDate = new Date(member.expiryDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (expiryDate < today) {
        return res.status(403).json({ error: 'Membership expired on ' + expiryDate.toLocaleDateString() + '. Please renew.' });
      }
    }

    const todayStr = new Date().toISOString().split('T')[0];

    const existingAttendance = await Attendance.findOne({ where: { userId: gymId, memberId: member.id, date: todayStr } });

    if (existingAttendance && existingAttendance.status === 'Present') {
      return res.json({
        success: true,
        alreadyChecked: true,
        message: `Welcome back ${member.name}! You already checked in today.`,
        memberName: member.name,
        memberId: member.id,
        checkinTime: existingAttendance.markedAt
      });
    }

    let attendance;
    if (existingAttendance) {
      existingAttendance.status = 'Present';
      existingAttendance.markedAt = new Date();
      existingAttendance.checkinMethod = 'qr_member';
      attendance = await existingAttendance.save();
    } else {
      attendance = await Attendance.create({
        userId: gymId, memberId: member.id, date: todayStr,
        status: 'Present', markedAt: new Date(), checkinMethod: 'qr_member'
      });
    }

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const lastWeekAttendances = await Attendance.findAll({
      where: { userId: gymId, memberId: member.id, date: { [Op.gte]: weekAgo } }
    });
    const weeklyCount = lastWeekAttendances.filter(a => a.status === 'Present').length;

    res.json({
      success: true,
      message: `✅ Welcome ${member.name}! Your attendance has been marked for today.`,
      memberName: member.name,
      memberId: member.id,
      memberPlan: member.plan,
      expiryDate: member.expiryDate,
      weeklyAttendance: weeklyCount,
      checkinTime: new Date()
    });
  } catch (err) {
    console.error('Member check-in error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get member's own attendance history
router.post('/my-attendance', async (req, res) => {
  try {
    const { gymQRData, memberId, phoneNumber } = req.body;
    if (!gymQRData) return res.status(400).json({ error: 'Gym QR data required' });

    const decoded = JSON.parse(Buffer.from(gymQRData, 'base64').toString());
    if (decoded.type !== 'gym_checkin') return res.status(400).json({ error: 'Invalid gym QR code' });

    const { gymId } = decoded;

    let member;
    if (memberId) {
      member = await Member.findOne({ where: { memberNo: memberId, userId: gymId } });
      if (!member) {
        member = await Member.findOne({ where: { id: memberId, userId: gymId } });
      }
    } else if (phoneNumber) {
      const cleanPhone = String(phoneNumber).replace(/[^0-9]/g, '');
      member = await Member.findOne({ where: { phone: cleanPhone, userId: gymId } });
    }
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    const startDateStr = startDate.toISOString().split('T')[0];

    const attendances = await Attendance.findAll({
      where: { userId: gymId, memberId: member.id, date: { [Op.gte]: startDateStr } },
      order: [['date', 'DESC']]
    });

    const history = attendances.map(a => ({ date: a.date, status: a.status, checkinMethod: a.checkinMethod }));

    res.json({
      memberName: member.name,
      memberPlan: member.plan,
      expiryDate: member.expiryDate,
      totalPresent: attendances.filter(a => a.status === 'Present').length,
      history
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: today's QR check-ins
router.get('/today-checkins', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.gymId || req.user.userId;
    const todayStr = new Date().toISOString().split('T')[0];

    const checkins = await Attendance.findAll({
      where: { userId, date: todayStr, status: 'Present' },
      include: [{ model: Member, as: 'member', attributes: ['id', 'name', 'phone', 'plan'] }]
    });

    const members = checkins
      .filter(c => c.member)
      .map(c => ({
        memberId: c.member.id,
        name: c.member.name,
        phone: c.member.phone,
        plan: c.member.plan,
        checkinTime: c.markedAt,
        method: c.checkinMethod
      }));

    res.json({ date: todayStr, totalCheckins: members.length, members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
