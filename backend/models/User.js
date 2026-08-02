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

  // ─── 3-tier role system ───────────────────────────────────
  role: {
    type: DataTypes.ENUM('superadmin', 'admin', 'staff'),
    defaultValue: 'admin'
  },

  // gymId — the admin's own id whose data this user shares
  gymId: { type: DataTypes.INTEGER, allowNull: true },

  gymName: { type: DataTypes.STRING, defaultValue: '' },

  // Max members this gym can add, set by superadmin. NULL = unlimited.
  // Editable anytime from the superadmin dashboard.
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

  // Password reset — user submits a new password, but it only takes
  // effect once approved (superadmin approves for an 'admin' account,
  // the gym admin approves for their own 'staff' accounts). The new
  // password is pre-hashed and held here until approval so the approver
  // never needs to see or handle the plaintext.
  resetPasswordRequested: { type: DataTypes.BOOLEAN, defaultValue: false },
  resetPasswordHash: { type: DataTypes.STRING, allowNull: true },
  resetPasswordRequestedAt: { type: DataTypes.DATE, allowNull: true }
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

// Same helper the frontend/routes rely on
User.prototype.comparePassword = async function (pwd) {
  return bcrypt.compare(pwd, this.password);
};

// Add a Mongo-style "_id" alongside "id" so the existing frontend
// (built expecting Mongo's _id field) keeps working without changes.
User.prototype.toJSON = function () {
  const values = { ...this.get() };
  values._id = String(values.id);
  return values;
};

module.exports = User;
