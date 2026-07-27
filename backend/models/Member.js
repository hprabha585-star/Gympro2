const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Member = sequelize.define('Member', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },

  name: { type: DataTypes.STRING, allowNull: false },
  phone: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: { is: { args: /^\d{10}$/, msg: 'Please enter a valid 10-digit phone number' } }
  },
  email: { type: DataTypes.STRING, defaultValue: '' },
  age: { type: DataTypes.INTEGER, validate: { min: 12, max: 100 } },
  gender: { type: DataTypes.ENUM('Male', 'Female', 'Other', ''), defaultValue: '' },
  photo: { type: DataTypes.TEXT('long'), defaultValue: '' },

  // Arrays / nested objects → JSON columns (MySQL 8 / 5.7.8+)
  healthConditions: { type: DataTypes.JSON, defaultValue: [] }, // [{condition, severity, notes}]
  medicalNotes: { type: DataTypes.TEXT, defaultValue: '' },
  emergencyContact: {
    type: DataTypes.JSON,
    defaultValue: { name: '', phone: '', relationship: '' }
  },

  plan: { type: DataTypes.STRING, allowNull: false },

  // Financial fields
  planPrice: { type: DataTypes.FLOAT, defaultValue: 0 },
  discountType: { type: DataTypes.STRING, defaultValue: 'none' },
  discountValue: { type: DataTypes.FLOAT, defaultValue: 0 },
  discountReason: { type: DataTypes.STRING, defaultValue: '' },
  admissionFee: { type: DataTypes.FLOAT, defaultValue: 0 },
  admissionWaived: { type: DataTypes.BOOLEAN, defaultValue: false },
  ptEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
  ptFee: { type: DataTypes.FLOAT, defaultValue: 0 },
  ptTrainer: { type: DataTypes.STRING, defaultValue: '' },
  ptNotes: { type: DataTypes.STRING, defaultValue: '' },

  joinDate: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  expiryDate: { type: DataTypes.DATE, allowNull: false },
  lastPaymentDate: { type: DataTypes.DATE, allowNull: true },
  nextPaymentDue: { type: DataTypes.DATE, allowNull: true },
  lastReminderSent: { type: DataTypes.DATE, allowNull: true },

  lastPaymentMethod: { type: DataTypes.ENUM('upi', 'cash', 'card'), allowNull: true },
  lastPaymentAmount: { type: DataTypes.FLOAT, defaultValue: 0 },
  paymentHistory: { type: DataTypes.JSON, defaultValue: [] }, // [{amount,date,method,receiptNo,plan,months}]

  status: { type: DataTypes.ENUM('Active', 'Trial', 'Inactive', 'Expired'), defaultValue: 'Active' },

  // Outstanding balance when a member pays less than the full amount due
  // (e.g. pays half now, rest later). 0 = fully paid up.
  pendingAmount: { type: DataTypes.FLOAT, defaultValue: 0 },

  // Auto-assigned sequential member number per gym
  memberNo: { type: DataTypes.INTEGER, allowNull: true }
}, {
  tableName: 'members',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['userId', 'phone'] },
    { fields: ['userId', 'expiryDate'] },
    { fields: ['userId', 'status'] }
  ],
  hooks: {
    // Same auto-numbering logic as the old Mongoose pre('save') hook
    beforeCreate: async (member) => {
      if (member.memberNo) return;
      try {
        const last = await Member.findOne({
          where: { userId: member.userId },
          order: [['memberNo', 'DESC']]
        });
        member.memberNo = (last && last.memberNo) ? last.memberNo + 1 : 1001;
      } catch (e) {
        member.memberNo = (Date.now() % 10000) + 1000; // fallback
      }
    }
  }
});

Member.prototype.toJSON = function () {
  const values = { ...this.get() };
  values._id = String(values.id);
  return values;
};

module.exports = Member;
