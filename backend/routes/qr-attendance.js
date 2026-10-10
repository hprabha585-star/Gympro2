const express = require('express');
const router = express.Router();
const { Member, Attendance, User, Gym } = require('../models');
const { Op } = require('sequelize');
const authMiddleware = require('../middleware/auth');

// DATE FIX: the server runs in UTC, so new Date().toISOString().split('T')[0]
// returned YESTERDAY for Indian users between 12:00am and 5:30am IST.
// Compute the calendar date in the gym's timezone instead.
const GYM_TZ = process.env.GYM_TIMEZONE || 'Asia/Kolkata';
function todayStr(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: GYM_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Generate GYM QR code (for the gym entrance)
router.get('/gym-qr', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const gymId = req.user.gymId || userId;

    let gymName = 'GymPro';

    // FIX: staff tokens carry gymId = the OWNER's user id, so the old
    // "gymId === userId ? User : Gym" test sent staff to the Gym table and
    // returned 404 (that's why gym-qr.html needed a client-side fallback).
    // Look in Users first (primary gyms), then the Gym table (extra gyms).
    const ownerRow = await User.findByPk(gymId);
    if (ownerRow && ownerRow.role === 'admin') {
      gymName = ownerRow.gymName || ownerRow.name || 'GymPro';
    } else {
      const gym = await Gym.findByPk(gymId);
      if (!gym) return res.status(404).json({ error: 'Gym not found' });
      gymName = gym.name;
    }

    const qrData = {
      gymId: gymId,
      gymName: gymName,
      type: 'gym_checkin',
      timestamp: Date.now()
    };

    const encodedData = Buffer.from(JSON.stringify(qrData)).toString('base64');

    // Base URL: set PUBLIC_URL in .env (e.g. https://yourdomain.com); falls back to the request's own host.
    const baseUrl = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const checkinUrl = `${baseUrl}/member-checkin.html?qr=${encodeURIComponent(encodedData)}`;

    res.json({
      qrString: checkinUrl,
      qrData: encodedData,
      gymName: gymName,
      gymId: gymId,
      checkinUrl
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Brute-force guard for the public check-in page ─────────────────────────
// The check-in screen now shows the member's PHOTO, so guessing phone numbers
// must be hard. Only FAILED lookups count: 10 misses in 10 minutes from one
// IP and that IP is paused. Real members (who type their own number) are never
// affected, even on shared gym Wi-Fi.
const missLog = new Map();
const MISS_LIMIT = 10, MISS_WINDOW = 10 * 60 * 1000;
function tooManyMisses(ip) {
  const now = Date.now();
  const hits = (missLog.get(ip) || []).filter(t => now - t < MISS_WINDOW);
  missLog.set(ip, hits);
  return hits.length >= MISS_LIMIT;
}
function recordMiss(ip) {
  const hits = missLog.get(ip) || [];
  hits.push(Date.now());
  missLog.set(ip, hits);
  if (missLog.size > 5000) { // keep memory bounded
    for (const [k, v] of missLog) if (!v.some(t => Date.now() - t < MISS_WINDOW)) missLog.delete(k);
  }
}

function findMemberFromBody({ memberId, phoneNumber }, gymId) {
  if (memberId) {
    // only the public Member ID (memberNo) - never the internal row id
    return Member.findOne({ where: { memberNo: parseInt(memberId, 10) || -1, userId: gymId, isDeleted: false } });
  }
  if (phoneNumber) {
    const cleanPhone = String(phoneNumber).replace(/[^0-9]/g, '').slice(-10);
    return Member.findOne({ where: { phone: cleanPhone, userId: gymId, isDeleted: false } });
  }
  return Promise.resolve(null);
}

// Everything the gate needs to recognise the person: photo, name, ID, expiry.
function memberCard(member) {
  const expStr = member.expiryDate ? new Date(member.expiryDate).toISOString().slice(0, 10) : null;
  let daysLeft = null;
  if (expStr) {
    daysLeft = Math.round((new Date(expStr + 'T00:00:00Z') - new Date(todayStr() + 'T00:00:00Z')) / 86400000);
  }
  return {
    memberName: member.name,
    memberId: member.id,
    memberNo: member.memberNo || null,
    memberPlan: member.plan,
    memberPhoto: (typeof member.photo === 'string' && member.photo.startsWith('data:image/')) ? member.photo : '',
    expiryDate: expStr,
    daysLeft
  };
}

// Member self check-in (public)
router.post('/member-checkin', async (req, res) => {
  try {
    const { qrData, memberId, phoneNumber } = req.body;
    if (!qrData) return res.status(400).json({ error: 'QR data required' });

    if (tooManyMisses(req.ip)) {
      return res.status(429).json({ error: 'Too many wrong attempts. Please wait 10 minutes or ask the gym staff.' });
    }

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
    const member = await findMemberFromBody({ memberId, phoneNumber }, gymId);

    if (!member) {
      recordMiss(req.ip);
      return res.status(404).json({ code: 'NOT_FOUND', error: 'Member not found. Please check your Member ID or Phone number.' });
    }

    const card = memberCard(member);
    const today = todayStr();

    // 1) EXPIRED -> entry refused (shown in red with the member's photo + expiry date)
    if (card.expiryDate && card.expiryDate < today) {
      const [y, mo, d] = card.expiryDate.split('-');
      return res.status(403).json({
        success: false, code: 'EXPIRED', ...card,
        error: `Membership expired on ${d}/${mo}/${y}. Please renew at the desk.`
      });
    }

    // 2) Frozen / inactive / expired status -> refused
    if (member.status !== 'Active' && member.status !== 'Trial') {
      return res.status(403).json({
        success: false, code: 'INACTIVE', ...card,
        error: 'Membership is not active. Please contact gym staff.'
      });
    }

    // 3) Already entered today -> RED "already entered" with photo + first entry time
    const existingAttendance = await Attendance.findOne({ where: { userId: gymId, memberId: member.id, date: today } });
    if (existingAttendance && existingAttendance.status === 'Present') {
      return res.status(409).json({
        success: false, code: 'ALREADY_CHECKED_IN', alreadyChecked: true, ...card,
        checkinTime: existingAttendance.markedAt,
        error: 'This member has already checked in today.'
      });
    }

    // 4) First entry today -> allowed
    try {
      if (existingAttendance) {            // staff had marked Absent earlier
        existingAttendance.status = 'Present';
        existingAttendance.markedAt = new Date();
        existingAttendance.checkinMethod = 'qr_member';
        await existingAttendance.save();
      } else {
        await Attendance.create({
          userId: gymId, memberId: member.id, date: today,
          status: 'Present', markedAt: new Date(), checkinMethod: 'qr_member'
        });
      }
    } catch (e) {
      // two scans at the same instant: the unique (gym, member, date) index lets only one in
      if (e.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ success: false, code: 'ALREADY_CHECKED_IN', alreadyChecked: true, ...card,
          checkinTime: new Date(), error: 'This member has already checked in today.' });
      }
      throw e;
    }

    const weekAgo = todayStr(-7);
    const lastWeekAttendances = await Attendance.findAll({
      where: { userId: gymId, memberId: member.id, date: { [Op.gte]: weekAgo } }
    });
    const weeklyCount = lastWeekAttendances.filter(a => a.status === 'Present').length;

    res.json({
      success: true, code: 'OK', ...card,
      message: `Welcome ${member.name}! Your attendance has been marked for today.`,
      weeklyAttendance: weeklyCount,
      checkinTime: new Date()
    });
  } catch (err) {
    console.error('Member check-in error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Get member's own attendance history
router.post('/my-attendance', async (req, res) => {
  try {
    const { gymQRData, memberId, phoneNumber } = req.body;
    if (!gymQRData) return res.status(400).json({ error: 'Gym QR data required' });
    if (tooManyMisses(req.ip)) return res.status(429).json({ error: 'Too many wrong attempts. Please wait 10 minutes.' });

    let decoded;
    try { decoded = JSON.parse(Buffer.from(gymQRData, 'base64').toString()); }
    catch (e) { return res.status(400).json({ error: 'Invalid QR code' }); }
    if (decoded.type !== 'gym_checkin') return res.status(400).json({ error: 'Invalid gym QR code' });

    const { gymId } = decoded;
    const member = await findMemberFromBody({ memberId, phoneNumber }, gymId);
    if (!member) { recordMiss(req.ip); return res.status(404).json({ error: 'Member not found' }); }

const startDateStr = todayStr(-30);

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
    const today = todayStr();

    const checkins = await Attendance.findAll({
      where: { userId, date: today, status: 'Present' },
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

    res.json({ date: today, totalCheckins: members.length, members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
