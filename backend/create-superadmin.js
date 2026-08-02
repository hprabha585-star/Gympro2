/**
 * create-superadmin.js
 * Run ONCE on server: node create-superadmin.js
 * Creates your (app creator) super-admin account.
 */
const { sequelize, User } = require('./models');
require('dotenv').config();

async function main() {
  await sequelize.authenticate();
  await sequelize.sync();
  console.log('✅ MySQL connected');

  const EMAIL    = 'hprabha585@gmail.com';
  const PASSWORD = 'Hariprabha143@';
  const NAME     = 'Hareesh (GymPro Creator)';

  let user = await User.findOne({ where: { email: EMAIL } });

  if (user) {
    user.role = 'superadmin';
    user.isApproved = true;
    user.pendingApproval = false;
    user.isActive = true;
    user.name = NAME;
    await user.save();
    console.log('✅ Super-admin updated');
  } else {
    user = await User.create({
      name: NAME, email: EMAIL, password: PASSWORD,
      role: 'superadmin', isApproved: true, pendingApproval: false, isActive: true
    });
    console.log('✅ Super-admin created');
  }

  console.log('\n══════════════════════════════════════');
  console.log('  GymPro Super-Admin Account');
  console.log('══════════════════════════════════════');
  console.log(`  Email    : ${EMAIL}`);
  console.log(`  Role     : superadmin`);
  console.log('══════════════════════════════════════\n');

  await sequelize.close();
}

main().catch(e => { console.error(e); process.exit(1); });
