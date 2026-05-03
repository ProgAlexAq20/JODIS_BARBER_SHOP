/**
 * App Logic - Integração Firebase com Interface
 * Reutiliza funções visuais existentes, substitui apenas o necessário
 */

import {
  loginWithEmail,
  logoutUser,
  onAuthChange,
  getActiveServices,
  getActiveBarbers,
  getBusinessSettings,
  getAvailableSlots,
  createAppointment,
  onBarberAppointmentsToday,
  onAllAppointments,
  updateAppointmentStatus,
  getDayKPIs,
  getMonthKPIs,
  getBarberDayKPIs,
  getBarberMonthKPIs
} from './firebase-service.js';

// Firebase imports inline para uso em dashboards
import {
  collection,
  query,
  where,
  getDocs
} from 'https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js';

// ════════════════════════════════════
// GLOBAL STATE
// ════════════════════════════════════

const appState = {
  currentUser: null,
  selectedService: null,
  selectedBarber: null,
  selectedDate: null,
  selectedTime: null,
  services: [],
  barbers: [],
  businessSettings: null,
  isLoadingSlots: false
};

// ════════════════════════════════════
// AUTH & REDIRECT
// ════════════════════════════════════

let unsubscribeAuth = null;

export function initAuth() {
  unsubscribeAuth = onAuthChange(async (user) => {
    appState.currentUser = user;
    
    if (!user) {
      // Usuário deslogado
      if (!['landing', 'booking'].includes(getCurrentScreen())) {
        showScreen('login');
      }
      return;
    }

    // Usuário logado - redireciona conforme role
    if (user.role === 'admin') {
      showScreen('admin-dash');
      initAdminDashboard();
    } else if (user.role === 'barber') {
      showScreen('barber-dash');
      initBarberDashboard(user);
    }
  });
}

function getCurrentScreen() {
  const active = document.querySelector('.screen.active');
  return active ? active.id.replace('screen-', '') : 'landing';
}

// ════════════════════════════════════
// LOGIN
// ════════════════════════════════════

export async function handleLogin(email, password) {
  try {
    showLoadingState(true, '#screen-login button.btn-primary');
    const user = await loginWithEmail(email, password);
    
    // Redirect automático feito por onAuthChange
    showToast('✓ Login realizado!');
    showLoadingState(false, '#screen-login button.btn-primary');
  } catch (e) {
    showLoadingState(false, '#screen-login button.btn-primary');
    showToast('✗ ' + e.message);
  }
}

export async function handleLogout() {
  try {
    await logoutUser();
    // onAuthChange vai automaticamente redirecionar para login
    showToast('✓ Desconectado');
  } catch (e) {
    showToast('✗ Erro ao desconectar');
  }
}

// Expõe globalmente para botões
window.handleLogout = handleLogout;

// Sobrescreve função original
window.doLogin = async function() {
  const email = document.getElementById('login-email')?.value;
  const password = document.getElementById('login-password')?.value;
  
  if (!email || !password) {
    showToast('Preencha email e senha');
    return;
  }
  
  await handleLogin(email, password);
};

// Tornar funções globais para eventos onclick
window.showScreen = showScreen;
window.showToast = showToast;
window.handleLogout = handleLogout;

// ════════════════════════════════════
// BOOKING - CARREGA DADOS REAIS
// ════════════════════════════════════

export async function initBookingScreen() {
  try {
    // Carrega serviços e barbeiros
    appState.services = await getActiveServices();
    appState.barbers = await getActiveBarbers();
    appState.businessSettings = await getBusinessSettings();

    // Renderiza serviços
    renderServiceCards();
    
    // Renderiza barbeiros
    renderBarberCards();
    
    // Sincroniza summary
    updateSummary();
  } catch (e) {
    console.error('Erro ao iniciar agendamento:', e);
    showToast('✗ Erro ao carregar dados. Tente novamente.');
  }
}

function renderServiceCards() {
  const grid = document.querySelector('#block-1 .booking-grid');
  if (!grid) return;

  if (appState.services.length === 0) {
    grid.innerHTML = '<p style="color: var(--muted); grid-column: 1/-1;">Nenhum serviço disponível. Verifique Firestore.</p>';
    return;
  }

  grid.innerHTML = appState.services.map((service, idx) => `
    <div class="booking-option ${idx === 0 ? 'selected' : ''}" onclick="selectServiceReal('${service.id}', this)">
      <div class="opt-name">${service.name}</div>
      <div class="opt-meta">${service.durationMinutes} min · R$ ${service.price}</div>
    </div>
  `).join('');

  if (appState.services.length > 0) {
    appState.selectedService = appState.services[0];
    updateSummary();
  }
}

function renderBarberCards() {
  const grid = document.querySelector('#block-2 .booking-grid');
  if (!grid) return;

  if (appState.barbers.length === 0) {
    grid.innerHTML = '<p style="color: var(--muted); grid-column: 1/-1;">Nenhum barbeiro disponível. Verifique Firestore.</p>';
    return;
  }

  grid.innerHTML = appState.barbers.map((barber, idx) => `
    <div class="booking-option ${idx === 0 ? 'selected' : ''}" onclick="selectBarberReal('${barber.id}', this)">
      <div class="opt-name">${barber.name}</div>
      <div class="opt-meta">${barber.roleTitle} · ★${barber.rating}</div>
    </div>
  `).join('');

  if (appState.barbers.length > 0) {
    appState.selectedBarber = appState.barbers[0];
    updateSummary();
  }
}

// Chamadas globais para onclick
window.selectServiceReal = function(serviceId, el) {
  const service = appState.services.find(s => s.id === serviceId);
  if (!service) return;
  el.parentElement.querySelectorAll('.booking-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  appState.selectedService = service;
  updateSummary();
};

window.selectBarberReal = function(barberId, el) {
  const barber = appState.barbers.find(b => b.id === barberId);
  if (!barber) return;
  el.parentElement.querySelectorAll('.booking-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  appState.selectedBarber = barber;
  updateSummary();
  // Se houver data, recarrega horários para novo barbeiro
  if (appState.selectedDate) {
    loadTimeSlotsForSelectedDate();
  }
};

// Sobrescreve selectDay para carregar horários e capturar data
const originalSelectDay = window.selectDay;
window.selectDay = async function(el) {
  originalSelectDay(el);
  
  const dayText = el.textContent.trim();
  if (!dayText || el.classList.contains('disabled')) return;

  appState.selectedDate = formatDateForFirestore(dayText);
  updateSummary();
  await loadTimeSlotsForSelectedDate();
};

// Sobrescreve selectTime para capturar horário
const originalSelectTime = window.selectTime;
window.selectTime = function(el) {
  if (el.classList.contains('unavailable')) return;
  originalSelectTime(el);
  appState.selectedTime = el.textContent.trim();
  updateSummary();
};

// Sobrescreve confirmBooking para salvar no Firebase
const originalConfirmBooking = window.confirmBooking;
window.confirmBooking = async function() {
  await handleConfirmBooking();
};

async function handleConfirmBooking() {
  const name = document.getElementById('client-name')?.value;
  const phone = document.getElementById('client-phone')?.value;
  const email = document.getElementById('client-email')?.value;

  // Validação
  if (!appState.selectedService || !appState.selectedBarber || !appState.selectedDate || !appState.selectedTime || !name || !phone) {
    showToast('✗ Preencha todos os campos obrigatórios');
    return;
  }

  try {
    showLoadingState(true, '#block-4 button.btn-primary');

    // Gera appointmentId determinístico
    const appointmentId = `${appState.selectedBarber.id}_${appState.selectedDate}_${appState.selectedTime.replace(':', '-')}`;

    const appointmentData = {
      appointmentKey: appointmentId,
      clientName: name,
      clientPhone: phone,
      clientEmail: email || '',
      serviceId: appState.selectedService.id,
      serviceName: appState.selectedService.name,
      servicePrice: appState.selectedService.price,
      serviceDuration: appState.selectedService.durationMinutes,
      barberId: appState.selectedBarber.id,
      barberName: appState.selectedBarber.name,
      date: appState.selectedDate,
      time: appState.selectedTime,
      status: 'confirmed',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await createAppointment(appointmentData);
    
    showLoadingState(false, '#block-4 button.btn-primary');
    showToast('✓ Agendamento confirmado! Você receberá uma confirmação por SMS.');
    
    // Limpa formulário
    document.getElementById('client-name').value = '';
    document.getElementById('client-phone').value = '';
    document.getElementById('client-email').value = '';
    
    setTimeout(() => showScreen('landing'), 2500);
  } catch (e) {
    showLoadingState(false, '#block-4 button.btn-primary');
    showToast('✗ ' + e.message);
  }
}

async function loadTimeSlotsForSelectedDate() {
  if (!appState.selectedDate || !appState.selectedBarber) return;

  try {
    appState.isLoadingSlots = true;
    const slots = await getAvailableSlots(appState.selectedBarber.id, appState.selectedDate);
    renderTimeSlots(slots);
    appState.isLoadingSlots = false;
  } catch (e) {
    console.error('Erro ao carregar horários:', e);
    appState.isLoadingSlots = false;
  }
}

function renderTimeSlots(slots) {
  const container = document.querySelector('.time-slots');
  if (!container) return;

  if (!slots || slots.length === 0) {
    container.innerHTML = `
      <p style="color: var(--muted); grid-column: 1/-1;">
        Nenhum horário disponível para esta data.
      </p>
    `;
    return;
  }

  container.innerHTML = slots.map(slot => `
    <div class="time-slot" onclick="selectTime(this)">
      ${slot}
    </div>
  `).join('');
}

function formatDateForFirestore(dayText) {
  // Busca o mês da UI (ex: "Maio 2025")
  const monthEl = document.querySelector('.cal-month');
  const [monthStr, yearStr] = monthEl.textContent.split(' ');
  
  const months = {
    'Janeiro': '01', 'Fevereiro': '02', 'Março': '03', 'Abril': '04',
    'Maio': '05', 'Junho': '06', 'Julho': '07', 'Agosto': '08',
    'Setembro': '09', 'Outubro': '10', 'Novembro': '11', 'Dezembro': '12'
  };
  
  const month = months[monthStr];
  const year = yearStr;
  const day = String(dayText).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function updateSummary() {
  const sumService = document.getElementById('sum-service');
  const sumBarber = document.getElementById('sum-barber');
  const sumDate = document.getElementById('sum-date');
  const sumTime = document.getElementById('sum-time');
  const sumDuration = document.getElementById('sum-duration');
  const sumTotal = document.getElementById('sum-total');

  if (appState.selectedService) {
    if (sumService) sumService.textContent = appState.selectedService.name;
    if (sumDuration) sumDuration.textContent = `${appState.selectedService.durationMinutes} min`;
    if (sumTotal) sumTotal.textContent = `R$ ${appState.selectedService.price.toFixed(2)}`;
  }

  if (appState.selectedBarber && sumBarber) {
    sumBarber.textContent = appState.selectedBarber.name;
  }

  if (appState.selectedDate && sumDate) {
    // Converte de YYYY-MM-DD para formato legível
    const [year, month, day] = appState.selectedDate.split('-');
    const months = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    sumDate.textContent = `${day} de ${months[parseInt(month)]}, ${year}`;
  }

  if (appState.selectedTime && sumTime) {
    sumTime.textContent = appState.selectedTime;
  }
}

// Sobrescreve bookStep para iniciar agendamento
const originalBookStep = window.bookStep;
window.bookStep = async function(n) {
  originalBookStep(n);
  if (n === 1) {
    await initBookingScreen();
  }
};

// ════════════════════════════════════
// BARBER DASHBOARD
// ════════════════════════════════════

let unsubscribeBarberAppts = null;

async function initBarberDashboard(user) {
  // Valida se usuário é barbeiro e tem barberId
  if (!user.barberId) {
    showToast('✗ Usuário não possui barberId configurado');
    showScreen('login');
    return;
  }

  const today = formatToday();
  
  // Atualiza header com dados reais
  const initials = user.avatarInitials || (user.name.match(/\b\w/g) || []).join('').slice(0, 2).toUpperCase();
  document.querySelector('.sidebar-avatar').textContent = initials;
  document.querySelector('.sidebar-name').textContent = user.name;
  document.querySelector('.dash-greeting').textContent = `Bom dia, ${user.name.split(' ')[0]}.`;
  document.querySelector('.dash-date').textContent = `${formatTodayPtBr()} · Carregando...`;

  // Carrega KPIs do dia APENAS para este barbeiro
  try {
    const kpi = await getBarberDayKPIs(user.barberId, today);
    
    // Atualiza KPIs com IDs específicos
    const kpiTodayCount = document.getElementById('barber-kpi-today-count');
    const kpiDayRevenue = document.getElementById('barber-kpi-day-revenue');
    const kpiDoneCount = document.getElementById('barber-kpi-done-count');
    const kpiCanceledCount = document.getElementById('barber-kpi-canceled-count');
    
    if (kpiTodayCount) kpiTodayCount.textContent = kpi.total;
    if (kpiDayRevenue) kpiDayRevenue.textContent = `R$ ${kpi.revenueExpected.toFixed(2)}`;
    if (kpiDoneCount) kpiDoneCount.textContent = kpi.done;
    if (kpiCanceledCount) kpiCanceledCount.textContent = kpi.canceled;
    
    // Atualiza texto da data com total
    document.querySelector('.dash-date').textContent = `${formatTodayPtBr()} · ${kpi.total} atendimento${kpi.total !== 1 ? 's' : ''} hoje`;
  } catch (e) {
    console.error('Erro ao carregar KPIs:', e);
  }

  // Listener realtime para agendamentos
  if (unsubscribeBarberAppts) unsubscribeBarberAppts();
  unsubscribeBarberAppts = onBarberAppointmentsToday(user.barberId, today, (appts) => {
    renderBarberAppointments(appts);
  });
}

function renderBarberAppointments(appts) {
  const list = document.querySelector('.appointment-list');
  if (!list) return;

  if (appts.length === 0) {
    list.innerHTML = '<p style="color: var(--muted); text-align: center; padding: 2rem;">Nenhum agendamento para hoje</p>';
    return;
  }

  list.innerHTML = appts.map(appt => {
    const statusClass = `status-${appt.status === 'done' ? 'done' : appt.status === 'confirmed' ? 'confirmed' : 'waiting'}`;
    const [hour, min] = appt.time.split(':');
    const period = hour < 12 ? 'AM' : 'PM';

    return `
      <div class="appt">
        <div class="appt-time">
          <div class="appt-hour">${hour}:${min}</div>
          <div class="appt-period">${period}</div>
        </div>
        <div>
          <div class="appt-client">${appt.clientName}</div>
          <div class="appt-service">${appt.serviceName} · ${appt.serviceDuration}min</div>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <div class="appt-status ${statusClass}">${translateStatus(appt.status)}</div>
          <select onchange="updateApptStatus('${appt.id}', this.value)" style="background: var(--card); border: 1px solid var(--border); color: var(--white); padding: 0.3rem; font-size: 0.7rem;">
            <option value="confirmed" ${appt.status === 'confirmed' ? 'selected' : ''}>Confirmado</option>
            <option value="in_progress" ${appt.status === 'in_progress' ? 'selected' : ''}>Atendendo</option>
            <option value="done" ${appt.status === 'done' ? 'selected' : ''}>Concluído</option>
            <option value="canceled" ${appt.status === 'canceled' ? 'selected' : ''}>Cancelado</option>
          </select>
        </div>
      </div>
    `;
  }).join('');
}

function translateStatus(status) {
  const map = { confirmed: 'Confirmado', in_progress: 'Atendendo', done: 'Concluído', canceled: 'Cancelado' };
  return map[status] || status;
}

window.updateApptStatus = async function(appointmentId, newStatus) {
  try {
    await updateAppointmentStatus(appointmentId, newStatus);
    showToast('✓ Status atualizado');
  } catch (e) {
    showToast('✗ Erro: ' + e.message);
  }
};

window.cancelAppointment = async function(appointmentId) {
  if (!confirm('Tem certeza que deseja cancelar este agendamento?')) return;
  
  try {
    await updateAppointmentStatus(appointmentId, 'canceled');
    showToast('✓ Agendamento cancelado');
  } catch (e) {
    showToast('✗ Erro: ' + e.message);
  }
};

// ════════════════════════════════════
// LANDING PAGE - BARBERS
// ════════════════════════════════════

/**
 * Renderiza barbeiros ativos na seção #barbers da landing page
 * Chamado quando a landing page é carregada
 */
export async function renderLandingBarbers() {
  const container = document.getElementById('landing-barbers-grid');
  if (!container) return;

  try {
    const barbers = await getActiveBarbers();
    
    if (barbers.length === 0) {
      container.innerHTML = '<p style="color: var(--muted);">Carregando barbeiros...</p>';
      return;
    }

    container.innerHTML = barbers.map(barber => `
      <div class="barber-card" onclick="showScreen('booking')">
        <div class="barber-avatar">${barber.avatarInitials || (barber.name.match(/\b\w/g) || []).join('').slice(0, 2).toUpperCase()}</div>
        <div class="barber-name">${barber.name}</div>
        <div class="barber-role">${barber.roleTitle || 'Barbeiro'}</div>
        <div class="barber-rating"><span>★</span> ${barber.rating || '4.9'} (${barber.reviewCount || '0'})</div>
      </div>
    `).join('');
  } catch (e) {
    console.error('Erro ao carregar barbeiros da landing:', e);
    container.innerHTML = '<p style="color: var(--muted);">Erro ao carregar barbeiros.</p>';
  }
}

// ════════════════════════════════════
// ADMIN DASHBOARD
// ════════════════════════════════════

let unsubscribeAdminAppts = null;

async function initAdminDashboard() {
  const today = formatToday();
  const yearMonth = today.slice(0, 7);

  // Carrega KPIs
  const dayKPIs = await getDayKPIs(today);
  const monthKPIs = await getMonthKPIs(yearMonth);

  // Atualiza cards de KPI do dia
  document.querySelectorAll('.revenue-card')[0].querySelector('.revenue-value').textContent = `R$ ${monthKPIs.revenue.toFixed(2)}`;
  document.querySelectorAll('.revenue-card')[1].querySelector('.revenue-value').textContent = monthKPIs.count;
  document.querySelectorAll('.revenue-card')[2].querySelector('.revenue-value').textContent = `R$ ${monthKPIs.avgTicket.toFixed(2)}`;

  // KPIs gerais
  document.querySelectorAll('.kpi')[0].querySelector('.kpi-value').textContent = '67'; // mockado
  document.querySelectorAll('.kpi')[1].querySelector('.kpi-value').textContent = '78%'; // mockado
  document.querySelectorAll('.kpi')[2].querySelector('.kpi-value').textContent = '4.2%'; // mockado
  document.querySelectorAll('.kpi')[3].querySelector('.kpi-value').textContent = '4.8 ★'; // mockado

  // Listener realtime para agendamentos do dia
  if (unsubscribeAdminAppts) unsubscribeAdminAppts();
  unsubscribeAdminAppts = onAllAppointments((appts) => {
    renderAdminAppointments(appts.filter(a => a.date === today));
  }, today);

  // Renderiza performance da equipe
  if (monthKPIs.barberRevenue) {
    const teamList = document.querySelector('.team-list');
    if (teamList) {
      teamList.innerHTML = Object.entries(monthKPIs.barberRevenue).map(([barberName, revenue]) => `
        <div class="team-row">
          <div class="team-avatar">${(barberName.match(/\b\w/g) || []).join('').slice(0, 2).toUpperCase()}</div>
          <div><div class="team-name">${barberName}</div><div class="team-role">Barbeiro</div></div>
          <div class="team-appts"><div style="font-size:0.65rem;color:var(--muted);">Fatur.</div>R$ ${revenue.toFixed(0)}</div>
        </div>
      `).join('');
    }
  }
}

function renderAdminAppointments(appts) {
  const list = document.querySelector('.appointment-list');
  if (!list) return;

  if (appts.length === 0) {
    list.innerHTML = '<p style="color: var(--muted); text-align: center; padding: 2rem;">Nenhum agendamento para hoje</p>';
    return;
  }

  list.innerHTML = appts.map(appt => {
    const statusClass = `status-${appt.status === 'done' ? 'done' : appt.status === 'confirmed' ? 'confirmed' : 'waiting'}`;
    const [hour, min] = appt.time.split(':');
    const period = hour < 12 ? 'AM' : 'PM';

    return `
      <div class="appt">
        <div class="appt-time">
          <div class="appt-hour">${hour}:${min}</div>
          <div class="appt-period">${period}</div>
        </div>
        <div>
          <div class="appt-client">${appt.clientName}</div>
          <div class="appt-service">${appt.serviceName} · R$ ${appt.servicePrice}</div>
        </div>
        <div class="appt-status ${statusClass}">${translateStatus(appt.status)}</div>
      </div>
    `;
  }).join('');
}

// ════════════════════════════════════
// UTILS
// ════════════════════════════════════

/**
 * Retorna data de hoje em formato YYYY-MM-DD (timezone: America/Sao_Paulo)
 */
function formatToday() {
  const now = new Date();
  // Converte para São Paulo (-03:00)
  const spTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const year = spTime.getFullYear();
  const month = String(spTime.getMonth() + 1).padStart(2, '0');
  const day = String(spTime.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTodayPtBr() {
  const now = new Date();
  const days = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const d = days[now.getDay()];
  const day = now.getDate();
  const m = months[now.getMonth()];
  return `${d[0].toUpperCase() + d.substring(1)}, ${day} de ${m}`;
}

function showLoadingState(isLoading, buttonSelector = null) {
  let btn = null;
  
  if (buttonSelector) {
    btn = document.querySelector(buttonSelector);
  } else {
    // Fallback: encontra o botão de action primária visível
    const visibleScreen = document.querySelector('.screen.active');
    if (visibleScreen) {
      btn = visibleScreen.querySelector('button.btn-primary[onclick*="doLogin"], button.btn-primary[onclick*="confirmBooking"]');
    }
  }
  
  if (btn) {
    btn.disabled = isLoading;
    btn.style.opacity = isLoading ? 0.6 : 1;
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => {
    s.style.display = 'none';
    s.classList.remove('active');
  });
  const target = document.getElementById('screen-' + name);
  if (!target) return;
  target.style.display = (name === 'login') ? 'flex' : 'block';
  target.classList.add('active');
  window.scrollTo(0, 0);
  
  // Inicializa booking quando clica em "Agendar"
  if (name === 'booking') {
    initBookingScreen();
  }
}

// Expõe globalmente
window.showScreen = showScreen;
window.showToast = showToast;

// ════════════════════════════════════
// INIT
// ════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  // Renderiza barbeiros na landing page quando estiver na tela de landing
  if (document.getElementById('screen-landing')) {
    renderLandingBarbers();
  }
});
