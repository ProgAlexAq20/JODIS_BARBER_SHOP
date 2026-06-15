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

const collections = ['settings', 'services', 'barbers', 'users', 'appointments', 'clients', 'exports'];

async function exportCollection(name) {
  const snap = await db.collection(name).get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}

async function backupFirestore() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(__dirname, 'backups', timestamp);
  fs.mkdirSync(outDir, { recursive: true });

  const payload = {
    exportedAt: new Date().toISOString(),
    projectId: serviceAccount.project_id || 'unknown',
    collections: {},
  };

  for (const collectionName of collections) {
    try {
      payload.collections[collectionName] = await exportCollection(collectionName);
      console.log(`Exportado: ${collectionName} (${payload.collections[collectionName].length} docs)`);
    } catch (error) {
      payload.collections[collectionName] = { error: error.message };
      console.warn(`Falha ao exportar ${collectionName}:`, error.message);
    }
  }

  fs.writeFileSync(
    path.join(outDir, 'firestore-backup.json'),
    JSON.stringify(payload, null, 2),
    'utf8'
  );

  console.log(`Backup salvo em: ${path.join(outDir, 'firestore-backup.json')}`);
}

backupFirestore().catch((error) => {
  console.error('Erro ao fazer backup do Firestore:', error);
  process.exit(1);
});
