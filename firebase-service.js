/**
 * Firebase Service - Queries & Business Logic
 */
 
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js';
 
import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  setDoc,
  updateDoc,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js';

function ensureFirebaseReady() {
  if (!window.auth || !window.db) {
    throw new Error('Firebase não inicializado. Verifique a conexão e o arquivo firebase-config.js.');
  }
}
 
// ════════════════════════════════════
// AUTH
// ════════════════════════════════════
 
export async function loginWithEmail(email, password) {
  try {
    ensureFirebaseReady();
    const userCred = await signInWithEmailAndPassword(window.auth, email, password);
    const user = userCred.user;
    const userDoc = await getDoc(doc(window.db, 'users', user.uid));
 
    if (!userDoc.exists()) throw new Error('Usuário não encontrado no banco');
    if (!userDoc.data().active) throw new Error('Usuário desativado');
 
    return { uid: user.uid, ...userDoc.data() };
  } catch (e) {
    throw new Error(e.message);
  }
}
 
export async function logoutUser() {
  ensureFirebaseReady();
  return signOut(window.auth);
}

export function onAuthChange(callback) {
  ensureFirebaseReady();
  return onAuthStateChanged(window.auth, async (user) => {
    if (!user) {
      callback(null);
      return;
    }
    try {
      const userDoc = await getDoc(doc(window.db, 'users', user.uid));
      callback(userDoc.exists() ? { uid: user.uid, ...userDoc.data() } : null);
    } catch (e) {
      console.error('Erro ao carregar perfil autenticado:', e);
      callback(null);
    }
  });
}
 
// ════════════════════════════════════
// SERVICES
// ════════════════════════════════════
 
export async function getActiveServices() {
  try {
    ensureFirebaseReady();
    const q = query(
      collection(window.db, 'services'),
      where('active', '==', true)
    );
    const snap = await getDocs(q);
    const services = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return services.sort((a, b) => (a.order || 999) - (b.order || 999));
  } catch (e) {
    console.error('Erro ao carregar serviços:', e);
    return [];
  }
}

export async function getAllServices() {
  try {
    ensureFirebaseReady();
    const snap = await getDocs(collection(window.db, 'services'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order || 999) - (b.order || 999));
  } catch (e) {
    console.error('Erro ao carregar todos os serviços:', e);
    return [];
  }
}

function slugifyServiceName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `service_${Date.now()}`;
}

export async function createService(serviceData) {
  ensureFirebaseReady();
  const name = String(serviceData.name || '').trim();
  if (!name) throw new Error('Nome do serviço é obrigatório');
  if (serviceData.price === '' || serviceData.price === undefined || Number.isNaN(Number(serviceData.price))) {
    throw new Error('Preço do serviço é obrigatório');
  }
  if (serviceData.durationMinutes === '' || serviceData.durationMinutes === undefined || Number.isNaN(Number(serviceData.durationMinutes))) {
    throw new Error('Duração do serviço é obrigatória');
  }

  const id = serviceData.id || slugifyServiceName(name);
  const payload = {
    name,
    price: Number(serviceData.price),
    durationMinutes: Number(serviceData.durationMinutes),
    active: Boolean(serviceData.active),
    order: Number(serviceData.order || 999),
    description: String(serviceData.description || '').trim(),
    updatedAt: new Date(),
    createdAt: new Date()
  };

  await setDoc(doc(window.db, 'services', id), payload, { merge: true });
  return { id, ...payload };
}

export async function updateService(serviceId, serviceData) {
  ensureFirebaseReady();
  if (!serviceId) throw new Error('ID do serviço inválido');
  const name = String(serviceData.name || '').trim();
  if (!name) throw new Error('Nome do serviço é obrigatório');

  const payload = {
    name,
    price: Number(serviceData.price),
    durationMinutes: Number(serviceData.durationMinutes),
    active: Boolean(serviceData.active),
    order: Number(serviceData.order || 999),
    description: String(serviceData.description || '').trim(),
    updatedAt: new Date()
  };

  await updateDoc(doc(window.db, 'services', serviceId), payload);
  return { id: serviceId, ...payload };
}

export async function deleteService(serviceId) {
  ensureFirebaseReady();
  if (!serviceId) throw new Error('ID do serviço inválido');
  await deleteDoc(doc(window.db, 'services', serviceId));
  return { success: true };
}

// ════════════════════════════════════
// BARBERS
// ════════════════════════════════════
 
export async function getActiveBarbers() {
  try {
    ensureFirebaseReady();
    const q = query(
      collection(window.db, 'barbers'),
      where('active', '==', true)
    );
    const snap = await getDocs(q);
    const barbers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return barbers.sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    console.error('Erro ao carregar barbeiros:', e);
    return [];
  }
}
 
// ════════════════════════════════════
// SETTINGS / BUSINESS
// ════════════════════════════════════
 
export async function getBusinessSettings() {
  try {
    ensureFirebaseReady();
    const snap = await getDoc(doc(window.db, 'settings', 'business'));
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    console.error('Erro ao carregar configurações:', e);
    return null;
  }
}
 
// ════════════════════════════════════
// APPOINTMENTS
// ════════════════════════════════════
 
/**
 * Gera horários disponíveis baseado em settings e agendamentos existentes.
 * Se o visitante não tiver permissão para ler appointments,
 * retorna todos os slots gerados (validação de conflito fica no setDoc via Rules).
 */
export async function getAvailableSlots(barberId, dateStr) {
  ensureFirebaseReady();
  const settings = await getBusinessSettings();
  if (!settings) return [];
 
  const [openH] = settings.openHour.split(':').map(Number);
  const [closeH] = settings.closeHour.split(':').map(Number);
  const interval = settings.slotIntervalMinutes || 30;
 
  const slots = [];
  for (let h = openH; h < closeH; h++) {
    for (let m = 0; m < 60; m += interval) {
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
 
  try {
    const q = query(
      collection(window.db, 'appointments'),
      where('barberId', '==', barberId),
      where('date', '==', dateStr)
    );
 
    const snap = await getDocs(q);
 
    const booked = snap.docs
      .map(d => d.data())
      .filter(a => a.status !== 'canceled')
      .map(a => a.time);
 
    return slots.filter(slot => !booked.includes(slot));
  } catch (e) {
    // Visitante sem permissão de leitura: retorna todos os slots.
    // O setDoc com ID determinístico bloqueará o conflito via Firestore Rules.
    console.warn(
      'Sem permissão para ler appointments. Exibindo todos os horários e validando na confirmação.',
      e
    );
    return slots;
  }
}
 
/**
 * Cria agendamento usando setDoc com ID determinístico.
 * O ID é composto por barberId + date + time, garantindo unicidade.
 * As Firestore Rules bloqueiam update (já existente), permitindo apenas create.
 */
export async function createAppointment(appointmentData) {
  ensureFirebaseReady();
  // appointmentKey deve ser: `${barberId}_${date}_${time}` — gerado pelo caller
  const appointmentId = appointmentData.appointmentKey;

  const requiredFields = [
    'appointmentKey',
    'clientName',
    'clientPhone',
    'serviceId',
    'serviceName',
    'servicePrice',
    'serviceDuration',
    'barberId',
    'barberName',
    'date',
    'time',
    'status'
  ];

  for (const field of requiredFields) {
    if (appointmentData[field] === undefined || appointmentData[field] === null || appointmentData[field] === '') {
      throw new Error(`Campo obrigatório ausente: ${field}`);
    }
  }

  try {
    const docRef = doc(window.db, 'appointments', appointmentId);
 
    // setDoc sem merge: se o doc já existir as Rules devem negar (update bloqueado)
    await setDoc(docRef, {
      ...appointmentData,
      createdAt: new Date()
    });
 
    // Tenta salvar/atualizar cliente (falha silenciosa se sem permissão)
    try {
      const clientRef = doc(window.db, 'clients', appointmentData.clientPhone);
      await setDoc(clientRef, {
        name: appointmentData.clientName,
        phone: appointmentData.clientPhone,
        email: appointmentData.clientEmail || '',
        lastAppointmentAt: new Date(),
        updatedAt: new Date()
      });
    } catch (clientError) {
      console.warn('Agendamento criado, mas cliente não foi salvo:', clientError);
    }
 
    return { success: true, appointmentId };
  } catch (e) {
    console.error('Erro ao criar agendamento:', e);
 
    if (
      e.code === 'permission-denied' ||
      String(e.message).toLowerCase().includes('permission')
    ) {
      throw new Error('Horário indisponível. Escolha outro horário.');
    }
 
    throw new Error(e.message || 'Erro ao criar agendamento.');
  }
}
 
/**
 * Busca agendamentos do barbeiro para o dia (requer login)
 * Sem orderBy para evitar necessidade de índice composto no Firestore.
 * Ordenação por time feita no JavaScript após o snapshot.
 */
export function onBarberAppointmentsToday(barberId, dateStr, callback) {
  const q = query(
    collection(window.db, 'appointments'),
    where('barberId', '==', barberId),
    where('date', '==', dateStr)
  );

  return onSnapshot(q, (snap) => {
    let appts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Ordena por time no JavaScript para evitar índice composto
    appts.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    callback(appts);
  }, (e) => {
    console.error('Erro ao ouvir agendamentos:', e);
    callback([]);
  });
}
 
/**
 * Busca todos os agendamentos (admin)
 */
export function onAllAppointments(callback, dateFilter = null) {
  let q;
  if (dateFilter) {
    q = query(
      collection(window.db, 'appointments'),
      where('date', '==', dateFilter)
    );
  } else {
    q = query(
      collection(window.db, 'appointments')
    );
  }
 
  return onSnapshot(q, (snap) => {
    let appts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Ordena por date e time no JavaScript para evitar índices
    appts.sort((a, b) => {
      const dateCompare = (b.date || '').localeCompare(a.date || '');
      if (dateCompare !== 0) return dateCompare;
      return (b.time || '').localeCompare(a.time || '');
    });
    callback(appts);
  }, (e) => {
    console.error('Erro ao ouvir agendamentos admin:', e);
    callback([]);
  });
}
 
/**
 * Atualiza status do agendamento (requer login)
 */
export async function updateAppointmentStatus(appointmentId, newStatus) {
  try {
    const allowedStatuses = ['confirmed', 'in_progress', 'done', 'canceled'];
    if (!allowedStatuses.includes(newStatus)) {
      throw new Error('Status inválido');
    }
    const docRef = doc(window.db, 'appointments', appointmentId);
    await updateDoc(docRef, {
      status: newStatus,
      updatedAt: new Date()
    });
    return { success: true };
  } catch (e) {
    throw new Error(e.message);
  }
}

/**
 * Exporta um snapshot mensal resumido para a coleção exports.
 * Mantém o volume controlado para não estourar limite de documento.
 */
export async function exportMonthlySnapshotToFirestore(yearMonth) {
  try {
    const allAppts = await getDocs(collection(window.db, 'appointments'));
    const monthAppts = allAppts.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(a => a.date && a.date.startsWith(yearMonth));

    const revenue = monthAppts.reduce((sum, a) => sum + (a.servicePrice || 0), 0);
    const count = monthAppts.length;
    const avgTicket = count > 0 ? revenue / count : 0;

    const serviceCounts = {};
    const barberRevenue = {};
    const statusCounts = { confirmed: 0, in_progress: 0, done: 0, canceled: 0 };

    monthAppts.forEach(a => {
      serviceCounts[a.serviceName] = (serviceCounts[a.serviceName] || 0) + 1;
      barberRevenue[a.barberName] = (barberRevenue[a.barberName] || 0) + (a.servicePrice || 0);
      if (statusCounts[a.status] !== undefined) {
        statusCounts[a.status] += 1;
      }
    });

    const exportId = `month_${yearMonth.replace('-', '_')}`;
    const exportRef = doc(window.db, 'exports', exportId);
    const exportData = {
      kind: 'monthly_snapshot',
      period: yearMonth,
      createdAt: new Date(),
      totalAppointments: count,
      revenue,
      avgTicket,
      statusCounts,
      topServices: Object.entries(serviceCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10),
      barberRevenue,
      appointmentIds: monthAppts.map(a => a.id)
    };

    await setDoc(exportRef, exportData, { merge: true });
    return { success: true, exportId, ...exportData };
  } catch (e) {
    console.error('Erro ao exportar snapshot mensal:', e);
    throw new Error(e.message || 'Não foi possível exportar os dados.');
  }
}
 
// ════════════════════════════════════
// KPI / ADMIN
// ════════════════════════════════════
 
export async function getDayKPIs(dateStr) {
  try {
    const q = query(
      collection(window.db, 'appointments'),
      where('date', '==', dateStr)
    );
    const snap = await getDocs(q);
    const appts = snap.docs.map(d => d.data());
 
    const revenue = appts.reduce((sum, a) => sum + (a.servicePrice || 0), 0);
    const count = appts.length;
    const avgTicket = count > 0 ? revenue / count : 0;
 
    return { revenue, count, avgTicket, appointments: appts };
  } catch (e) {
    console.error('Erro ao calcular KPI do dia:', e);
    return { revenue: 0, count: 0, avgTicket: 0, appointments: [] };
  }
}
 
/**
 * Busca KPIs do dia para um barbeiro específico
 */
export async function getBarberDayKPIs(barberId, dateStr) {
  try {
    const q = query(
      collection(window.db, 'appointments'),
      where('barberId', '==', barberId),
      where('date', '==', dateStr)
    );
    const snap = await getDocs(q);
    const appts = snap.docs.map(d => d.data());

    const confirmed = appts.filter(a => a.status === 'confirmed').length;
    const inProgress = appts.filter(a => a.status === 'in_progress').length;
    const done = appts.filter(a => a.status === 'done').length;
    const canceled = appts.filter(a => a.status === 'canceled').length;

    const revenueExpected = appts
      .filter(a => ['confirmed', 'in_progress', 'done'].includes(a.status))
      .reduce((sum, a) => sum + (a.servicePrice || 0), 0);

    const revenueDone = appts
      .filter(a => a.status === 'done')
      .reduce((sum, a) => sum + (a.servicePrice || 0), 0);

    return {
      total: appts.length,
      confirmed,
      inProgress,
      done,
      canceled,
      revenueExpected,
      revenueDone
    };
  } catch (e) {
    console.error('Erro ao calcular KPI do barbeiro:', e);
    return { total: 0, confirmed: 0, inProgress: 0, done: 0, canceled: 0, revenueExpected: 0, revenueDone: 0 };
  }
}

/**
 * Busca KPIs do mês para um barbeiro específico
 */
export async function getBarberMonthKPIs(barberId, yearMonth) {
  try {
    const allAppts = await getDocs(collection(window.db, 'appointments'));
    const monthAppts = allAppts.docs
      .map(d => d.data())
      .filter(a => a.date && a.date.startsWith(yearMonth) && a.barberId === barberId);

    const revenue = monthAppts.reduce((sum, a) => sum + (a.servicePrice || 0), 0);
    const count = monthAppts.length;
    const avgTicket = count > 0 ? revenue / count : 0;

    const done = monthAppts.filter(a => a.status === 'done').length;
    const canceled = monthAppts.filter(a => a.status === 'canceled').length;

    return {
      revenue,
      count,
      avgTicket,
      done,
      canceled,
      monthAppts
    };
  } catch (e) {
    console.error('Erro ao calcular KPI do mês do barbeiro:', e);
    return { revenue: 0, count: 0, avgTicket: 0, done: 0, canceled: 0, monthAppts: [] };
  }
}

export async function getMonthKPIs(yearMonth) {
  try {
    const allAppts = await getDocs(collection(window.db, 'appointments'));
    const monthAppts = allAppts.docs
      .map(d => d.data())
      .filter(a => a.date && a.date.startsWith(yearMonth));
 
    const revenue = monthAppts.reduce((sum, a) => sum + (a.servicePrice || 0), 0);
    const count = monthAppts.length;
    const avgTicket = count > 0 ? revenue / count : 0;
 
    const serviceCounts = {};
    monthAppts.forEach(a => {
      serviceCounts[a.serviceName] = (serviceCounts[a.serviceName] || 0) + 1;
    });
 
    const barberRevenue = {};
    monthAppts.forEach(a => {
      barberRevenue[a.barberName] = (barberRevenue[a.barberName] || 0) + (a.servicePrice || 0);
    });
 
    return {
      revenue,
      count,
      avgTicket,
      topServices: Object.entries(serviceCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
      barberRevenue,
      monthAppts
    };
  } catch (e) {
    console.error('Erro ao calcular KPI do mês:', e);
    return { revenue: 0, count: 0, avgTicket: 0, topServices: [], barberRevenue: {}, monthAppts: [] };
  }
}
