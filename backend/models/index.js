const sequelize = require('../config/database');
const User = require('./User');
const Member = require('./Member');
const Trainer = require('./Trainer');
const Attendance = require('./Attendance');
const Subscription = require('./Subscription');
const Gym = require('./Gym');

// ── Associations ──────────────────────────────────────────
// IMPORTANT: `userId` on Member/Trainer/Attendance is intentionally
// polymorphic — it holds a `users.id` when the active gym is an owner's
// PRIMARY gym, but a `gyms.id` (deliberately pushed to 1,000,000+ in
// server.js specifically so the two ranges never collide) when the active
// gym is one of their ADDITIONAL gyms via Manage Gym. A real database
// foreign key can only ever reference one table, so `constraints:false`
// here is required — without it, Sequelize creates an actual FK tying
// userId to `users.id`, which makes every insert (adding a member,
// trainer, or attendance record) fail with a foreign key violation the
// moment someone is working inside an additional gym, since that gym's
// id was never a real row in `users`.
User.hasMany(Member, { foreignKey: 'userId', constraints: false });
Member.belongsTo(User, { foreignKey: 'userId', constraints: false });

User.hasMany(Trainer, { foreignKey: 'userId', constraints: false });
Trainer.belongsTo(User, { foreignKey: 'userId', constraints: false });

User.hasMany(Attendance, { foreignKey: 'userId', constraints: false });
Attendance.belongsTo(User, { foreignKey: 'userId', constraints: false });

// alias 'member' used by routes to mimic Mongoose's .populate('memberId')
Member.hasMany(Attendance, { foreignKey: 'memberId' });
Attendance.belongsTo(Member, { foreignKey: 'memberId', as: 'member' });

User.hasOne(Subscription, { foreignKey: 'userId' });
Subscription.belongsTo(User, { foreignKey: 'userId' });

// Additional gyms (beyond an owner's original/primary one)
User.hasMany(Gym, { foreignKey: 'ownerId' });
Gym.belongsTo(User, { foreignKey: 'ownerId' });

module.exports = { sequelize, User, Member, Trainer, Attendance, Subscription, Gym };
