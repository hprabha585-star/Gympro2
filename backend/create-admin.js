/**
 * create-admin.js
 * Run once: node create-admin.js
 * Creates the master admin account for GymPro
 */
const { sequelize, User, Subscription } = require('./models');
require('dotenv').config();

async function createAdmin() {
  try {
    await sequelize.authenticate();
    await sequelize.sync();
    console.log('✅ MySQL Connected');

    const email    = 'hprabha585@gmail.com';
    const password = 'CHANGE_THIS_PASSWORD'; // ⚠️ set a real password before running
    const name     = 'GymPro Admin';

    let admin = await User.findOne({ where: { email } });
    if (admin) {
      admin.role = 'admin';
      await admin.save();
      console.log(`✅ Admin already exists — role confirmed as admin`);
      console.log(`   Email: ${email}`);
    } else {
      admin = await User.create({ name, email, password, role: 'admin', isApproved: true, pendingApproval: false, isActive: true });
      console.log(`✅ Admin created successfully`);
      console.log(`   Name:  ${name}`);
      console.log(`   Email: ${email}`);
    }

    // Permanent subscription (never expires)
    const permanentEnd = new Date('2099-12-31');
    let sub = await Subscription.findOne({ where: { userId: admin.id } });
    if (!sub) {
      await Subscription.create({ userId: admin.id, plan: 'yearly', status: 'active', startDate: new Date(), endDate: permanentEnd });
      console.log('✅ Admin permanent subscription created');
    } else {
      sub.plan = 'yearly'; sub.status = 'active'; sub.endDate = permanentEnd;
      await sub.save();
      console.log('✅ Admin subscription updated to permanent');
    }

    console.log('\n🎉 Admin setup complete!');
    await sequelize.close();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

createAdmin();
