const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Gym = sequelize.define('Gym', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  ownerId: { type: DataTypes.INTEGER, allowNull: false }, 
  name: { type: DataTypes.STRING, allowNull: false },
  isApproved: { type: DataTypes.BOOLEAN, defaultValue: false },
  pendingApproval: { type: DataTypes.BOOLEAN, defaultValue: true },
  rejectionReason: { type: DataTypes.STRING, defaultValue: '' },
  approvedAt: { type: DataTypes.DATE, allowNull: true },
  memberLimit: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
  
  // NEW: Stores independent plans, UPI, and fees for this specific additional gym
  gymData: { type: DataTypes.TEXT, defaultValue: '{}' }
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
