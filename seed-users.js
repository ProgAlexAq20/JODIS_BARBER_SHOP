const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error('serviceAccountKey.json não encontrado na raiz do projeto.');
  console.error('Adicione a chave de serviço localmente e execute novamente.');
  process.exit(1);
}

const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function seedUsers() {
  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const adminUid = process.env.ADMIN_UID || 'ADMIN_UID';
  const financeUid = process.env.FINANCE_UID || 'FINANCE_UID';
  const barberUid = process.env.BARBER_UID || 'BARBER_UID';

  const users = [
    {
      id: adminUid,
      email: 'admin@jodis.com',
      name: "Admin Jodi's",
      role: 'admin',
      barberId: '',
      active: true,
    },
    {
      id: financeUid,
      email: 'financeiro@jodis.com',
      name: "Financeiro Jodi's",
      role: 'finance',
      barberId: '',
      active: true,
    },
    {
      id: barberUid,
      email: 'jodi@jodis.com',
      name: 'Jodi',
      role: 'barber',
      barberId: 'jodi',
      active: true,
    },
  ];

  users.forEach((user) => {
    batch.set(db.doc(`users/${user.id}`), {
      ...user,
      createdAt: now,
      updatedAt: now,
    });
  });

  await batch.commit();
  console.log('Users seed executado com sucesso.');
  console.log(`Admin UID: ${adminUid}`);
  console.log(`Finance UID: ${financeUid}`);
  console.log(`Barber UID: ${barberUid}`);
}

seedUsers().catch((error) => {
  console.error('Erro ao popular users:', error);
  process.exit(1);
});
