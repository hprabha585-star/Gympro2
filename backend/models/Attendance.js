const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Attendance = sequelize.define('Attendance', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  memberId: { type: DataTypes.INTEGER, allowNull: false },
  date: { type: DataTypes.STRING, allowNull: false }, // 'YYYY-MM-DD', same format as before
  status: { type: DataTypes.ENUM('Present', 'Absent'), allowNull: false },
  markedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  checkinMethod: { type: DataTypes.ENUM('manual', 'qr_member', 'bulk'), defaultValue: 'manual' }
}, {
  tableName: 'attendances',
  timestamps: false,
  indexes: [
    { unique: true, fields: ['userId', 'memberId', 'date'] }
  ]
});

Attendance.prototype.toJSON = function () {
  const values = { ...this.get() };
  values._id = String(values.id);
  return values;
};

module.exports = Attendance;
