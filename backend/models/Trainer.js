const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Trainer = sequelize.define('Trainer', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  phone: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: { is: { args: /^\d{10}$/, msg: 'Please enter a valid 10-digit phone number' } }
  },
  specialty: { type: DataTypes.STRING, allowNull: false },
  status: { type: DataTypes.ENUM('Active', 'Inactive'), defaultValue: 'Active' },
  joinDate: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'trainers',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['userId', 'phone'] }
  ]
});

Trainer.prototype.toJSON = function () {
  const values = { ...this.get() };
  values._id = String(values.id);
  return values;
};

module.exports = Trainer;
