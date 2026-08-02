/**
 * migrate-mongo-to-mysql.js
 *
 * One-time script: copies all existing data from your old MongoDB Atlas
 * database into the new MySQL database, remapping Mongo ObjectIds to the
 * new MySQL auto-increment integer ids (and fixing up every foreign key
 * reference — gymId, userId, memberId, approvedBy — along the way).
 *
 * Requires: npm install mongoose   (devDependency, already in package.json)
 * Run:      node migrate-mongo-to-mysql.js
 *
 * Set OLD_MONGO_URI in your .env before running (your existing Atlas
 * connection string).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { sequelize, User, Member, Trainer, Attendance, Subscription } = require('./models');

// ── Minimal read-only Mongo schemas (just enough to read old data) ──
const oldUserSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const oldMemberSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const oldTrainerSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const oldAttendanceSchema = new mongoose.Schema({}, { strict: false });
const oldSubscriptionSchema = new mongoose.Schema({}, { strict: false });

const OldUser = mongoose.model('OldUser', oldUserSchema, 'users');
const OldMember = mongoose.model('OldMember', oldMemberSchema, 'members');
const OldTrainer = mongoose.model('OldTrainer', oldTrainerSchema, 'trainers');
const OldAttendance = mongoose.model('OldAttendance', oldAttendanceSchema, 'attendances');
let OldSubscription;
try { OldSubscription = mongoose.model('OldSubscription', oldSubscriptionSchema, 'subscriptions'); } catch (e) {}

async function migrate() {
  if (!process.env.OLD_MONGO_URI) {
    console.error('❌ Set OLD_MONGO_URI in your .env first (your Atlas connection string).');
    process.exit(1);
  }

  console.log('Connecting to old MongoDB...');
  await mongoose.connect(process.env.OLD_MONGO_URI);
  console.log('✅ Connected to MongoDB');

  console.log('Connecting to new MySQL...');
  await sequelize.authenticate();
  await sequelize.sync();
  console.log('✅ Connected to MySQL, tables ready');

  // Maps: old Mongo _id (string) → new MySQL integer id
  const userIdMap = new Map();
  const memberIdMap = new Map();

  // ── 1. Users (create first, without gymId/approvedBy — fixed in pass 2) ──
  const oldUsers = await OldUser.find({}).lean();
  console.log(`\nFound ${oldUsers.length} users`);
  for (const u of oldUsers) {
    const newUser = await User.create({
      name: u.name,
      email: u.email,
      password: u.password, // already bcrypt-hashed — copied as-is, no re-hash
      role: u.role || 'admin',
      gymName: u.gymName || '',
      staffPermissions: u.staffPermissions || undefined,
      isApproved: !!u.isApproved,
      pendingApproval: u.pendingApproval !== undefined ? u.pendingApproval : true,
      approvedByName: u.approvedByName || '',
      approvedAt: u.approvedAt || null,
      rejectionReason: u.rejectionReason || '',
      isActive: u.isActive !== undefined ? u.isActive : true,
      lastLogin: u.lastLogin || null,
      gymData: u.gymData || '{}',
      createdAt: u.createdAt || new Date(),
      updatedAt: u.updatedAt || new Date()
    }, { hooks: false }); // hooks:false → skip re-hashing password, it's already hashed
    userIdMap.set(String(u._id), newUser.id);
  }

  // ── 2. Second pass: fix gymId / approvedBy references now that all users exist ──
  for (const u of oldUsers) {
    const updates = {};
    if (u.gymId) updates.gymId = userIdMap.get(String(u.gymId)) || null;
    if (u.approvedBy) updates.approvedBy = userIdMap.get(String(u.approvedBy)) || null;
    if (Object.keys(updates).length) {
      await User.update(updates, { where: { id: userIdMap.get(String(u._id)) } });
    }
  }
  console.log('✅ Users migrated');

  // ── 3. Members ──
  const oldMembers = await OldMember.find({}).lean();
  console.log(`\nFound ${oldMembers.length} members`);
  for (const m of oldMembers) {
    const newUserId = userIdMap.get(String(m.userId));
    if (!newUserId) { console.warn(`  ⚠️ Skipping member ${m.name} — owner user not found`); continue; }

    const newMember = await Member.create({
      userId: newUserId,
      name: m.name,
      phone: m.phone,
      email: m.email || '',
      age: m.age || null,
      gender: m.gender || '',
      photo: m.photo || '',
      healthConditions: m.healthConditions || [],
      medicalNotes: m.medicalNotes || '',
      emergencyContact: m.emergencyContact || { name: '', phone: '', relationship: '' },
      plan: m.plan,
      planPrice: m.planPrice || 0,
      discountType: m.discountType || 'none',
      discountValue: m.discountValue || 0,
      discountReason: m.discountReason || '',
      admissionFee: m.admissionFee || 0,
      admissionWaived: !!m.admissionWaived,
      ptEnabled: !!m.ptEnabled,
      ptFee: m.ptFee || 0,
      ptTrainer: m.ptTrainer || '',
      ptNotes: m.ptNotes || '',
      joinDate: m.joinDate || new Date(),
      expiryDate: m.expiryDate,
      lastPaymentDate: m.lastPaymentDate || null,
      nextPaymentDue: m.nextPaymentDue || null,
      lastReminderSent: m.lastReminderSent || null,
      lastPaymentMethod: m.lastPaymentMethod || null,
      lastPaymentAmount: m.lastPaymentAmount || 0,
      paymentHistory: m.paymentHistory || [],
      status: m.status || 'Active',
      memberNo: m.memberNo || null,
      createdAt: m.createdAt || new Date(),
      updatedAt: m.updatedAt || new Date()
    });
    memberIdMap.set(String(m._id), newMember.id);
  }
  console.log('✅ Members migrated');

  // ── 4. Trainers ──
  const oldTrainers = await OldTrainer.find({}).lean();
  console.log(`\nFound ${oldTrainers.length} trainers`);
  for (const t of oldTrainers) {
    const newUserId = userIdMap.get(String(t.userId));
    if (!newUserId) { console.warn(`  ⚠️ Skipping trainer ${t.name} — owner user not found`); continue; }

    await Trainer.create({
      userId: newUserId,
      name: t.name,
      phone: t.phone,
      specialty: t.specialty,
      status: t.status || 'Active',
      joinDate: t.joinDate || new Date(),
      createdAt: t.createdAt || new Date(),
      updatedAt: t.updatedAt || new Date()
    });
  }
  console.log('✅ Trainers migrated');

  // ── 5. Attendance ──
  const oldAttendance = await OldAttendance.find({}).lean();
  console.log(`\nFound ${oldAttendance.length} attendance records`);
  let skipped = 0;
  for (const a of oldAttendance) {
    const newUserId = userIdMap.get(String(a.userId));
    const newMemberId = memberIdMap.get(String(a.memberId));
    if (!newUserId || !newMemberId) { skipped++; continue; }

    try {
      await Attendance.create({
        userId: newUserId,
        memberId: newMemberId,
        date: a.date,
        status: a.status,
        markedAt: a.markedAt || new Date(),
        checkinMethod: a.checkinMethod || 'manual'
      });
    } catch (e) {
      // likely a duplicate (userId, memberId, date) — safe to skip
      skipped++;
    }
  }
  console.log(`✅ Attendance migrated (${skipped} skipped — missing refs or duplicates)`);

  // ── 6. Subscriptions (if the collection exists) ──
  if (OldSubscription) {
    const oldSubs = await OldSubscription.find({}).lean();
    console.log(`\nFound ${oldSubs.length} subscriptions`);
    for (const s of oldSubs) {
      const newUserId = userIdMap.get(String(s.userId));
      if (!newUserId) continue;
      await Subscription.create({
        userId: newUserId,
        plan: s.plan || 'monthly',
        status: s.status || 'active',
        startDate: s.startDate || new Date(),
        endDate: s.endDate || null
      });
    }
    console.log('✅ Subscriptions migrated');
  }

  console.log('\n🎉 Migration complete!');
  console.log(`   Users:       ${oldUsers.length}`);
  console.log(`   Members:     ${oldMembers.length}`);
  console.log(`   Trainers:    ${oldTrainers.length}`);
  console.log(`   Attendance:  ${oldAttendance.length - skipped} of ${oldAttendance.length}`);

  await mongoose.disconnect();
  await sequelize.close();
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
