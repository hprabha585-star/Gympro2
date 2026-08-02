const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Represents an ADDITIONAL gym owned by an existing gym-owner account.
 *
 * IMPORTANT — backward compatibility: an owner's very first/original gym is
 * NOT a row in this table. It continues to be identified by the owner's own
 * User.id, exactly as before (so all existing Member/Trainer/Attendance
 * rows — which reference that id as "userId" — keep working with zero
 * migration). This table only holds gyms #2, #3, etc. that an owner adds
 * later, each requiring superadmin approval before it can be used.
 */
const Gym = sequelize.define('Gym', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  ownerId: { type: DataTypes.INTEGER, allowNull: false }, // -> User.id of the gym-owner account
  name: { type: DataTypes.STRING, allowNull: false },
  isApproved: { type: DataTypes.BOOLEAN, defaultValue: false },
  pendingApproval: { type: DataTypes.BOOLEAN, defaultValue: true },
  rejectionReason: { type: DataTypes.STRING, defaultValue: '' },
  approvedAt: { type: DataTypes.DATE, allowNull: true },

  // Max members this specific gym can add, set by superadmin at approval
  // time (or later). NULL = unlimited.
  memberLimit: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null }
}, {
  tableName: 'gyms',
  timestamps: true
});

Gym.prototype.toJSON = function () {
  const values = { ...this.get() };
  values._id = String(values.id);
  return values;
};

module.exports = Gym;
