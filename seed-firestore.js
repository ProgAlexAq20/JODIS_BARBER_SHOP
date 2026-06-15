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

async function seed() {
  const batch = db.batch();

  batch.set(db.doc('settings/business'), {
    openHour: '09:00',
    closeHour: '18:00',
    slotIntervalMinutes: 30,
    closedWeekdays: [0],
    blockedDates: [],
    holidays: [],
    timezone: 'America/Sao_Paulo',
    whatsapp: '5511999999999',
    whatsappNumber: '5511999999999',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const services = [
    {
      id: 'corte-classico',
      name: 'Corte Clássico',
      description: 'Corte personalizado com acabamento impecável.',
      price: 60,
      durationMinutes: 30,
      active: true,
      order: 1,
    },
    {
      id: 'barba-completa',
      name: 'Barba Completa',
      description: 'Modelagem, hidratação e finalização premium.',
      price: 40,
      durationMinutes: 30,
      active: true,
      order: 2,
    },
    {
      id: 'corte-barba',
      name: 'Corte + Barba',
      description: 'Combo completo cabelo e barba.',
      price: 90,
      durationMinutes: 60,
      active: true,
      order: 3,
    },
  ];

  services.forEach((service) => {
    batch.set(db.doc(`services/${service.id}`), {
      ...service,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  const barbers = [
    {
      id: 'jodi',
      name: 'Jodi',
      roleTitle: 'Master Barber',
      avatarInitials: 'JD',
      rating: 4.9,
      reviewCount: 150,
      active: true,
    },
    {
      id: 'alex',
      name: 'Alex',
      roleTitle: 'Barbeiro',
      avatarInitials: 'AX',
      rating: 4.8,
      reviewCount: 80,
      active: true,
    },
  ];

  barbers.forEach((barber) => {
    batch.set(db.doc(`barbers/${barber.id}`), {
      ...barber,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  await batch.commit();
  console.log('Firestore populado com sucesso.');
}

seed().catch((error) => {
  console.error('Erro ao popular Firestore:', error);
  process.exit(1);
});
