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
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  setDoc,
  updateDoc,
  runTransaction,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js';

// ════════════════════════════════════
// AUTH
// ════════════════════════════════════

export async function loginWithEmail(email, password) {
  try {
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
  return signOut(window.auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(window.auth, async (user) => {
    if (!user) {
      callback(null);
      return;
    }
    const userDoc = await getDoc(doc(window.db, 'users', user.uid));
    callback(userDoc.exists() ? { uid: user.uid, ...userDoc.data() } : null);
  });
}

// ════════════════════════════════════
// SERVICES
// ════════════════════════════════════

export async function getActiveServices() {
  try {
    const q = query(
      collection(window.db, 'services'),
      where('active', '==', true)
    );
    const snap = await getDocs(q);
    const services = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Ordena no JS para evitar índice composto
    return services.sort((a, b) => (a.order || 999) - (b.order || 999));
  } catch (e) {
    console.error('Erro ao carregar serviços:', e);
    return [];
  }
}

// ════════════════════════════════════
// BARBERS
// ════════════════════════════════════

export async function getActiveBarbers() {
  try {
    const q = query(
      collection(window.db, 'barbers'),
      where('active', '==', true)
    );
    const snap = await getDocs(q);
    const barbers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Retorna ordenado por name para consistência
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
 * Gera horários disponíveis baseado em settings e agendamentos existentes
 * Ignora agendamentos com status "canceled"
 */
export async function getAvailableSlots(barberId, dateStr) {
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
    console.warn('Não foi possível consultar horários ocupados. Exibindo todos os horários e validando na confirmação.', e);

    return slots;
  }
}

/**
 * Cria agendamento com transaction para evitar conflitos
 */
export async function createAppointment(appointmentData) {
  const appointmentId = appointmentData.appointmentKey;

  try {
    const docRef = doc(window.db, 'appointments', appointmentId);

    await setDoc(docRef, appointmentData);

    try {
      const clientRef = doc(window.db, 'clients', appointmentData.clientPhone);

      await setDoc(clientRef, {
        name: appointmentData.clientName,
        phone: appointmentData.clientPhone,
        email: appointmentData.clientEmail || '',
        lastAppointmentAt: new Date(),
        updatedAt: new Date()
      }, { merge: true });
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
 * Busca agendamentos do barbeiro para o dia
 */
export function onBarberAppointmentsToday(barberId, dateStr, callback) {
  const q = query(
    collection(window.db, 'appointments'),
    where('barberId', '==', barberId),
    where('date', '==', dateStr),
    orderBy('time', 'asc')
  );

  return onSnapshot(q, (snap) => {
    const appts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
      where('date', '==', dateFilter),
      orderBy('time', 'asc')
    );
  } else {
    q = query(
      collection(window.db, 'appointments'),
      orderBy('date', 'desc'),
      orderBy('time', 'desc')
    );
  }

  return onSnapshot(q, (snap) => {
    const appts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(appts);
  }, (e) => {
    console.error('Erro ao ouvir agendamentos admin:', e);
    callback([]);
  });
}

/**
 * Atualiza status do agendamento
 */
export async function updateAppointmentStatus(appointmentId, newStatus) {
  try {
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

// ════════════════════════════════════
// KPI / ADMIN
// ════════════════════════════════════

/**
 * Calcula KPIs do dia (admin)
 */
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
 * Calcula KPIs do mês (admin)
 */
export async function getMonthKPIs(yearMonth) {
  try {
    // Busca todos os agendamentos que começam com o prefixo do mês
    const allAppts = await getDocs(collection(window.db, 'appointments'));
    const monthAppts = allAppts.docs
      .map(d => d.data())
      .filter(a => a.date && a.date.startsWith(yearMonth));

    const revenue = monthAppts.reduce((sum, a) => sum + (a.servicePrice || 0), 0);
    const count = monthAppts.length;
    const avgTicket = count > 0 ? revenue / count : 0;

    // Serviços mais vendidos
    const serviceCounts = {};
    monthAppts.forEach(a => {
      serviceCounts[a.serviceName] = (serviceCounts[a.serviceName] || 0) + 1;
    });

    // Performance por barbeiro
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
