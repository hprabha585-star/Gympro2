const sequelize = require('../config/database');
const User = require('./User');
const Member = require('./Member');
const Trainer = require('./Trainer');
const Attendance = require('./Attendance');
const Subscription = require('./Subscription');
const Gym = require('./Gym');

// ── Associations ──────────────────────────────────────────
// IMPORTANT: constraints:false on the three below. "userId" on
// Member/Trainer/Attendance is intentionally dual-purpose in this app's
// multi-gym design — it's either a gym OWNER's User.id (their primary
// gym) OR a Gym.id (an additional gym they added via Manage Gym). A real
// database foreign key can only ever point at ONE of those tables, so it
// incorrectly rejected every insert made while an additional gym was
// active ("Cannot add or update a child row: a foreign key constraint
// fails ... members_ibfk_1"). Every route already scopes strictly by
// gymId in application code (see members.js, trainers.js, attendance.js),
// so DB-level enforcement here was both wrong and redundant.
// (No changes needed here — this file is already correct; confirmed
// working in the deploy logs: "dropped foreign key members_ibfk_1" etc.)
User.hasMany(Member, { foreignKey: 'userId', constraints: false });
Member.belongsTo(User, { foreignKey: 'userId', constraints: false });

User.hasMany(Trainer, { foreignKey: 'userId', constraints: false });
Trainer.belongsTo(User, { foreignKey: 'userId', constraints: false });

User.hasMany(Attendance, { foreignKey: 'userId', constraints: false });
Attendance.belongsTo(User, { foreignKey: 'userId', constraints: false });

// alias 'member' used by routes to mimic Mongoose's .populate('memberId')
// Kept as a real FK on purpose — memberId always points at exactly one
// Member row, no dual-purpose ambiguity here, so DB enforcement is correct
// and server.js's index cleanup now knows to leave its backing index alone.
Member.hasMany(Attendance, { foreignKey: 'memberId' });
Attendance.belongsTo(Member, { foreignKey: 'memberId', as: 'member' });

User.hasOne(Subscription, { foreignKey: 'userId' });
Subscription.belongsTo(User, { foreignKey: 'userId' });

// Additional gyms (beyond an owner's original/primary one)
User.hasMany(Gym, { foreignKey: 'ownerId' });
Gym.belongsTo(User, { foreignKey: 'ownerId' });

module.exports = { sequelize, User, Member, Trainer, Attendance, Subscription, Gym };
