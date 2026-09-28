const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// DATE FIX: expiry / join / payment dates are CALENDAR days, not instants.
// Whatever arrives ('2026-10-21', a full ISO string, a Date), store it as
// UTC-midnight of that calendar day (as seen in the gym's timezone). That way
// the day shown never shifts by one depending on server/browser timezone, and
// the frontend's `.split('T')[0]` always gets the right day.
const GYM_TZ = process.env.GYM_TIMEZONE || 'Asia/Kolkata';
function normDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + 'T00:00:00.000Z');
  const d = new Date(v);
  if (isNaN(d)) return v; // let Sequelize validation reject it
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: GYM_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return new Date(day + 'T00:00:00.000Z');
}
const dateCol = (name, extra = {}) => ({
  type: DataTypes.DATE,
  ...extra,
  set(value) { this.setDataValue(name, normDate(value)); }
});

const Member = sequelize.define('Member', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },

  name: { type: DataTypes.STRING, allowNull: false },
phone: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: { is: { args: /^(\d{10}(_del_\d+)?)$/, msg: 'Please enter a valid 10-digit phone number' } }
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

  joinDate: dateCol('joinDate', { defaultValue: () => normDate(new Date()) }),
  expiryDate: dateCol('expiryDate', { allowNull: false }),
  lastPaymentDate: dateCol('lastPaymentDate', { allowNull: true }),
  nextPaymentDue: dateCol('nextPaymentDue', { allowNull: true }),
  lastReminderSent: { type: DataTypes.DATE, allowNull: true },

  lastPaymentMethod: { type: DataTypes.ENUM('upi', 'cash', 'card'), allowNull: true },
  lastPaymentAmount: { type: DataTypes.FLOAT, defaultValue: 0 },
  paymentHistory: { type: DataTypes.JSON, defaultValue: [] }, // [{amount,date,method,receiptNo,plan,months}]

  status: { type: DataTypes.ENUM('Active', 'Trial', 'Inactive', 'Expired'), defaultValue: 'Active' },

  // Outstanding balance when a member pays less than the full amount due
  // (e.g. pays half now, rest later). 0 = fully paid up.
  pendingAmount: { type: DataTypes.FLOAT, defaultValue: 0 },
  // Marks member as soft-deleted to preserve their payment history for revenue
  isDeleted: { type: DataTypes.BOOLEAN, defaultValue: false },

  // Auto-assigned sequential member number per gym
  memberNo: { type: DataTypes.INTEGER, allowNull: true }
}, {
  tableName: 'members',
  timestamps: true,
  indexes: [
    { name: 'members_user_phone_unique', unique: true, fields: ['userId', 'phone'] },
    { name: 'members_user_expiry_idx', fields: ['userId', 'expiryDate'] },
    { name: 'members_user_status_idx', fields: ['userId', 'status'] }
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

Member.normDate = normDate;
module.exports = Member;
