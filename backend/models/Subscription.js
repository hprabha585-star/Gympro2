// NOTE: create-admin.js (original) referenced a Subscription model that
// was not among the uploaded backend files. This is a best-guess
// reconstruction based on the fields it used (plan, status, startDate,
// endDate). Delete this file + its usage in create-admin.js if you
// don't actually use subscriptions/billing anywhere else in your app.
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Subscription = sequelize.define('Subscription', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  plan: { type: DataTypes.STRING, defaultValue: 'monthly' },
  status: { type: DataTypes.STRING, defaultValue: 'active' },
  startDate: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  endDate: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'subscriptions',
  timestamps: true
});

Subscription.prototype.toJSON = function () {
  const values = { ...this.get() };
  values._id = String(values.id);
  return values;
};

module.exports = Subscription;
