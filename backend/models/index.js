const sequelize = require('../config/database');
const User = require('./User');
const Member = require('./Member');
const Trainer = require('./Trainer');
const Attendance = require('./Attendance');
const Subscription = require('./Subscription');
const Gym = require('./Gym');

// ── Associations ──────────────────────────────────────────
// IMPORTANT: userId on Member/Trainer/Attendance is a "gym scope id" —
// for an owner's PRIMARY gym it's their own User.id, but for an
// ADDITIONAL gym (see Gym.js) it's a row id from the `gyms` table
// instead. MySQL can't enforce a foreign key against "users OR gyms",
// so these associations use constraints:false to keep the logical
// relationship (for Sequelize's own convenience methods) WITHOUT
// generating a real FK constraint that would reject every additional
// gym's members/trainers/attendance with "Cannot add or update a child
// row: foreign key constraint fails".
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
