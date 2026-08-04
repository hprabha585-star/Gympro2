const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const sequelize = require('../config/database');

const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: { isEmail: { msg: 'Please enter a valid email' } }
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: { len: { args: [6, 255], msg: 'Password must be at least 6 characters' } }
  },

  role: {
    type: DataTypes.ENUM('superadmin', 'admin', 'staff'),
    defaultValue: 'admin'
  },
  gymId: { type: DataTypes.INTEGER, allowNull: true },
  gymName: { type: DataTypes.STRING, defaultValue: '' },
  memberLimit: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },

  staffPermissions: {
    type: DataTypes.JSON,
    defaultValue: {
      viewMembers: true, addMembers: true, editMembers: true, deleteMembers: false,
      viewAttendance: true, markAttendance: true, viewTrainers: true,
      viewPayments: true, viewRevenue: false, viewSettings: false
    }
  },

  isApproved: { type: DataTypes.BOOLEAN, defaultValue: false },
  pendingApproval: { type: DataTypes.BOOLEAN, defaultValue: true },
  approvedBy: { type: DataTypes.INTEGER, allowNull: true },
  approvedByName: { type: DataTypes.STRING, defaultValue: '' },
  approvedAt: { type: DataTypes.DATE, allowNull: true },
  rejectionReason: { type: DataTypes.STRING, defaultValue: '' },

  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  lastLogin: { type: DataTypes.DATE, allowNull: true },
  gymData: { type: DataTypes.TEXT, defaultValue: '{}' },

  // Password reset system
  resetRequested: { type: DataTypes.BOOLEAN, defaultValue: false },
  resetRequestedAt: { type: DataTypes.DATE, allowNull: true },
  pendingPassword: { type: DataTypes.STRING, allowNull: true } // securely holds the hashed requested password
}, {
  tableName: 'users',
  timestamps: true,
  indexes: [
    { name: 'users_email_unique', unique: true, fields: ['email'] }
  ],
  hooks: {
    beforeSave: async (user) => {
      if (user.changed('password')) {
        user.password = await bcrypt.hash(user.password, 10);
      }
    }
  }
});

User.prototype.comparePassword = async function (pwd) {
  return bcrypt.compare(pwd, this.password);
};

User.prototype.toJSON = function () {
  const values = { ...this.get() };
  values._id = String(values.id);
  return values;
};

module.exports = User;
