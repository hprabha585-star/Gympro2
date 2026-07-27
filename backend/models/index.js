const sequelize = require('../config/database');
const User = require('./User');
const Member = require('./Member');
const Trainer = require('./Trainer');
const Attendance = require('./Attendance');
const Subscription = require('./Subscription');

// ── Associations ──────────────────────────────────────────
User.hasMany(Member, { foreignKey: 'userId' });
Member.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(Trainer, { foreignKey: 'userId' });
Trainer.belongsTo(User, { foreignKey: 'userId' });

User.hasMany(Attendance, { foreignKey: 'userId' });
Attendance.belongsTo(User, { foreignKey: 'userId' });

// alias 'member' used by routes to mimic Mongoose's .populate('memberId')
Member.hasMany(Attendance, { foreignKey: 'memberId' });
Attendance.belongsTo(Member, { foreignKey: 'memberId', as: 'member' });

User.hasOne(Subscription, { foreignKey: 'userId' });
Subscription.belongsTo(User, { foreignKey: 'userId' });

module.exports = { sequelize, User, Member, Trainer, Attendance, Subscription };
