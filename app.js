/**
 * App Logic - Integração Firebase com Interface
 * Reutiliza funções visuais existentes, substitui apenas o necessário
 */

import {
  loginWithEmail,
  logoutUser,
  onAuthChange,
  getActiveServices,
  getAllServices,
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
  getBarberMonthKPIs,
  exportMonthlySnapshotToFirestore,
  createService,
  updateService,
  deleteService
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
  authResolved: false,
  selectedService: null,
  selectedBarber: null,
  selectedDate: null,
  selectedTime: null,
  selectedDateMeta: null,
  services: [],
  adminServices: [],
  editingServiceId: null,
  barbers: [],
  businessSettings: null,
  latestAppointment: null,
  isLoadingSlots: false
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getBusinessSettingList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }
  return [];
}

const barberOverrideEmails = new Set(['joi@jodis.com', 'jodi@jodis.com']);

function normalizeUserAccess(user) {
  if (!user) return null;

  const email = String(user.email || '').toLowerCase().trim();
  const normalizedRole = barberOverrideEmails.has(email) ? 'barber' : user.role;

  return {
    ...user,
    role: normalizedRole
  };
}

function buildWhatsAppBookingMessage() {
  if (!appState.latestAppointment) return '';

  const appt = appState.latestAppointment;
  return [
    'Olá Jodi.',
    '',
    'Gostaria de confirmar meu horário:',
    '',
    `Nome: ${appt.clientName}`,
    `Telefone: ${appt.clientPhone}`,
    `Serviço: ${appt.serviceName}`,
    `Barbeiro: ${appt.barberName}`,
    `Data: ${appt.dateLabel || appt.date}`,
    `Horário: ${appt.time}`,
    '',
    'Obrigado.'
  ].join('\n');
}

function openWhatsAppBooking() {
  const settings = appState.businessSettings || {};
  const phone = String(settings.whatsappNumber || settings.whatsapp || '5511999999999').replace(/\D/g, '') || '5511999999999';
  const message = buildWhatsAppBookingMessage();

  if (!message) {
    showToast('Finalize o agendamento para gerar a mensagem do WhatsApp');
    return;
  }

  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
}

function canAccessScreen(screenId, user = appState.currentUser) {
  const role = user?.role || null;
  const publicScreens = new Set(['landing', 'booking', 'login', 'access-denied']);

  if (publicScreens.has(screenId)) return true;
  if (!role) return false;

  if (screenId === 'barber-dash') {
    return role === 'barber';
  }

  if (screenId === 'admin-dash') {
    return role === 'admin' || role === 'finance';
  }

  return false;
}

function syncRestrictedUi() {
  const role = appState.currentUser?.role || null;
  const desktopBtn = document.getElementById('desktop-area-btn');
  const mobileLink = document.getElementById('mobile-area-link');

  if (desktopBtn) desktopBtn.hidden = !role;
  if (mobileLink) mobileLink.hidden = !role;

  document.querySelectorAll('[data-auth="admin"]').forEach(el => {
    el.hidden = !['admin', 'finance'].includes(role);
  });
  document.querySelectorAll('[data-auth="admin-only"]').forEach(el => {
    el.hidden = role !== 'admin';
  });
  document.querySelectorAll('[data-auth="finance"]').forEach(el => {
    el.hidden = !(role === 'admin' || role === 'finance');
  });
  document.querySelectorAll('[data-auth="barber"]').forEach(el => {
    el.hidden = role !== 'barber';
  });

  const sidebarBlocks = Array.from(document.querySelectorAll('.sidebar-nav li'));
  const hideLabels = role === 'barber'
    ? ['Clientes', 'Ganhos', 'Config.', 'Financeiro', 'Serviços', 'Relatórios', 'Equipe']
    : role === 'finance'
      ? ['Serviços', 'Clientes', 'Relatórios', 'Equipe', 'Config.']
      : ['Clientes', 'Relatórios', 'Equipe', 'Config.'];

  sidebarBlocks.forEach(item => {
    const text = item.textContent.replace(/\s+/g, ' ').trim();
    if (hideLabels.some(label => text.includes(label))) {
      item.hidden = true;
    }
  });
}

function showDataWarning(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 5500);
}

function showAccessDenied(reason = 'Você não tem permissão para acessar esta área.') {
  const target = document.getElementById('screen-access-denied');
  if (!target) {
    showScreen('login');
    return;
  }

  const message = target.querySelector('.access-denied-card p:nth-of-type(2)');
  if (message) message.textContent = reason;

  showScreen('access-denied');
}

function setAuthLoading(isLoading) {
  const overlay = document.getElementById('auth-loading');
  if (overlay) overlay.hidden = !isLoading;
}

function startAuthFallbackTimer() {
  window.clearTimeout(window.__authFallbackTimer);
  window.__authFallbackTimer = window.setTimeout(() => {
    if (!appState.authResolved) {
      setAuthLoading(false);
      if (!appState.currentUser) {
        showScreen('landing');
      }
    }
  }, 3500);
}

// ════════════════════════════════════
// AUTH & REDIRECT
// ════════════════════════════════════

let unsubscribeAuth = null;

export function initAuth() {
  try {
    setAuthLoading(true);
    startAuthFallbackTimer();
    unsubscribeAuth = onAuthChange(async (user) => {
      appState.currentUser = normalizeUserAccess(user);
      appState.authResolved = true;
      window.clearTimeout(window.__authFallbackTimer);
      syncRestrictedUi();
      setAuthLoading(false);
      
      if (!appState.currentUser) {
        // Usuário deslogado
        if (!['landing', 'booking', 'login', 'access-denied'].includes(getCurrentScreen())) {
          showScreen('landing');
        }
        return;
      }

      // Usuário logado - redireciona conforme role
      if (appState.currentUser.role === 'admin') {
        showScreen('admin-dash');
        initAdminDashboard();
      } else if (appState.currentUser.role === 'finance') {
        showScreen('admin-dash');
        initAdminDashboard({ mode: 'finance' });
        showFinancePanel();
      } else if (appState.currentUser.role === 'barber') {
        showScreen('barber-dash');
        initBarberDashboard(appState.currentUser);
      } else {
        showAccessDenied('Sua conta não possui permissão para acessar o painel interno.');
      }
    });
  } catch (e) {
    console.error('Firebase auth indisponível:', e);
    setAuthLoading(false);
    window.clearTimeout(window.__authFallbackTimer);
    showToast('Firebase indisponível. Verifique a configuração do projeto.');
    showScreen('landing');
  }
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

window.exportAdminData = async function() {
  try {
    if (!appState.currentUser || !['admin', 'finance'].includes(appState.currentUser.role)) {
      showToast('âœ— Apenas administradores financeiros podem exportar dados');
      return;
    }

    showLoadingState(true, 'button[onclick*="exportAdminData"]');
    const yearMonth = formatToday().slice(0, 7);
    const result = await exportMonthlySnapshotToFirestore(yearMonth);
    showToast(`âœ“ Exportação salva em Firestore (${result.exportId})`);
  } catch (e) {
    showToast('âœ— ' + e.message);
  } finally {
    showLoadingState(false, 'button[onclick*="exportAdminData"]');
  }
};

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
    renderCalendar();

    if (!appState.businessSettings) {
      showDataWarning('Firebase conectado, mas settings/business não foi encontrado.');
    } else if (appState.services.length === 0) {
      showDataWarning('Firebase conectado, mas services está vazio. Rode o seed local.');
    } else if (appState.barbers.length === 0) {
      showDataWarning('Firebase conectado, mas barbers está vazio. Verifique o seed.');
    }
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
    <div class="booking-option ${idx === 0 ? 'selected' : ''}" onclick='selectServiceReal(${JSON.stringify(service.id)}, this)'>
      <div class="opt-name">${escapeHtml(service.name)}</div>
      <div class="opt-meta">${escapeHtml(service.durationMinutes)} min · R$ ${escapeHtml(service.price)}</div>
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
    <div class="booking-option ${idx === 0 ? 'selected' : ''}" onclick='selectBarberReal(${JSON.stringify(barber.id)}, this)'>
      <div class="opt-name">${escapeHtml(barber.name)}</div>
      <div class="opt-meta">${escapeHtml(barber.roleTitle)} · ★${escapeHtml(barber.rating)}</div>
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
  const dayText = el.textContent.trim();
  if (!dayText || el.classList.contains('disabled')) return;

  originalSelectDay(el);

  appState.selectedDate = formatDateForFirestore(dayText);
  appState.selectedDateMeta = {
    year: calendarState.currentYear,
    month: calendarState.currentMonth,
    day: Number(dayText)
  };
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
  const clientSnapshot = {
    name: document.getElementById('client-name')?.value || '',
    phone: document.getElementById('client-phone')?.value || '',
    email: document.getElementById('client-email')?.value || ''
  };

  await handleConfirmBooking();

  if (appState.selectedService && appState.selectedBarber && appState.selectedDate && appState.selectedTime && clientSnapshot.name && clientSnapshot.phone) {
    appState.latestAppointment = {
      appointmentKey: `${appState.selectedBarber.id}_${appState.selectedDate}_${appState.selectedTime.replace(':', '-')}`,
      clientName: clientSnapshot.name,
      clientPhone: clientSnapshot.phone,
      clientEmail: clientSnapshot.email,
      serviceName: appState.selectedService.name,
      barberName: appState.selectedBarber.name,
      date: appState.selectedDate,
      time: appState.selectedTime,
      dateLabel: formatDateLabel(appState.selectedDate)
    };
  }
};

window.confirmBookingWhatsApp = openWhatsAppBooking;

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
  const meta = appState.selectedDateMeta;
  if (meta?.year != null && meta?.month != null) {
    return `${meta.year}-${String(meta.month + 1).padStart(2, '0')}-${String(dayText).padStart(2, '0')}`;
  }

  return formatToday();
}

function formatDateLabel(dateIso) {
  if (!dateIso || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return '';

  const [year, month, day] = dateIso.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(date);
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
  if (kpiDayRevenue) {
    const revenueCard = kpiDayRevenue.closest('.kpi');
    if (revenueCard) revenueCard.hidden = true;
  }
  if (kpiDoneCount) kpiDoneCount.textContent = kpi.done;
  if (kpiCanceledCount) kpiCanceledCount.textContent = kpi.canceled;
    
    // Atualiza texto da data com total
    document.querySelector('.dash-date').textContent = `${formatTodayPtBr()} · ${kpi.total} atendimento${kpi.total !== 1 ? 's' : ''} hoje`;
  } catch (e) {
    console.error('Erro ao carregar KPIs:', e);
  }

  const barberDash = document.getElementById('screen-barber-dash');
  if (barberDash) {
    const quickActions = Array.from(barberDash.querySelectorAll('.dash-card')).find(card =>
      card.querySelector('.dash-card-title')?.textContent.includes('Ações Rápidas')
    );
    if (quickActions) {
      quickActions.innerHTML = `
        <div class="dash-card-title">Ações Rápidas</div>
        <p style="color:var(--muted);line-height:1.8;padding:1rem 0 0;">Em breve: bloqueio de horários, histórico e ajustes rápidos.</p>
      `;
    }

    const upcoming = Array.from(barberDash.querySelectorAll('.dash-card')).find(card =>
      card.querySelector('.dash-card-title')?.textContent.includes('Próximos Dias')
    );
    if (upcoming) {
      upcoming.innerHTML = `
        <div class="dash-card-title">Próximos Dias</div>
        <p style="color:var(--muted);line-height:1.8;padding:1rem 0 0;">Em breve: visão de agenda futura.</p>
      `;
    }
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
          <div class="appt-client">${escapeHtml(appt.clientName)}</div>
          <div class="appt-service">${escapeHtml(appt.serviceName)} · ${escapeHtml(appt.serviceDuration)}min</div>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <div class="appt-status ${statusClass}">${translateStatus(appt.status)}</div>
          <select onchange='updateApptStatus(${JSON.stringify(appt.id)}, this.value)' style="background: var(--card); border: 1px solid var(--border); color: var(--white); padding: 0.3rem; font-size: 0.7rem;">
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
      container.innerHTML = '<p style="color: var(--muted);">Nenhum barbeiro disponível no Firestore.</p>';
      return;
    }

    container.innerHTML = barbers.map(barber => `
      <div class="barber-card" onclick="showScreen('booking')">
        <div class="barber-avatar">${escapeHtml(barber.avatarInitials || (barber.name.match(/\b\w/g) || []).join('').slice(0, 2).toUpperCase())}</div>
        <div class="barber-name">${escapeHtml(barber.name)}</div>
        <div class="barber-role">${escapeHtml(barber.roleTitle || 'Barbeiro')}</div>
        <div class="barber-rating"><span>★</span> ${escapeHtml(barber.rating || '4.9')} (${escapeHtml(barber.reviewCount || '0')})</div>
      </div>
    `).join('');
  } catch (e) {
    console.error('Erro ao carregar barbeiros da landing:', e);
    container.innerHTML = '<p style="color: var(--muted);">Erro ao carregar barbeiros. Verifique o Firestore.</p>';
  }
}

export async function renderLandingServices() {
  const container = document.getElementById('landing-services-grid');
  if (!container) return;

  try {
    const services = appState.services.length ? appState.services : await getActiveServices();
    appState.services = services;

    if (!services.length) {
      container.innerHTML = '<p style="color: var(--muted); grid-column: 1/-1;">Nenhum serviço disponível no Firestore.</p>';
      return;
    }

    container.innerHTML = services.map(service => `
      <div class="service-card premium-card fade-up">
        <div class="premium-chip">${escapeHtml(service.durationMinutes)} min</div>
        <div class="service-icon">✦</div>
        <div class="service-name">${escapeHtml(service.name)}</div>
        <div class="service-desc">${escapeHtml(service.description || 'Serviço premium personalizado para seu visual.')}</div>
        <div class="service-price">R$ ${escapeHtml(Number(service.price || 0).toFixed(2))}</div>
      </div>
    `).join('');
  } catch (e) {
    console.error('Erro ao carregar serviços da landing:', e);
    container.innerHTML = '<p style="color: var(--muted); grid-column: 1/-1;">Erro ao carregar serviços. Verifique o Firestore.</p>';
  }
}

window.openGalleryModal = function(src, caption = '') {
  const modal = document.getElementById('gallery-modal');
  const image = modal?.querySelector('img');
  if (!modal || !image) return;

  image.src = src || '';
  image.alt = caption || 'Galeria ampliada';
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
};

window.closeGalleryModal = function() {
  const modal = document.getElementById('gallery-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
};

function initFaqAccordion() {
  document.querySelectorAll('.faq-item').forEach(item => {
    const button = item.querySelector('.faq-question');
    if (!button || button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    button.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item').forEach(other => other.classList.remove('open'));
      if (!isOpen) item.classList.add('open');
    });
  });
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
  const kpiCards = document.querySelectorAll('.kpi');
  if (kpiCards[0]) kpiCards[0].querySelector('.kpi-value').textContent = dayKPIs.count;
  if (kpiCards[1]) kpiCards[1].querySelector('.kpi-value').textContent = `R$ ${dayKPIs.revenue.toFixed(2)}`;
  if (kpiCards[2]) kpiCards[2].querySelector('.kpi-value').textContent = `R$ ${monthKPIs.avgTicket.toFixed(2)}`;
  if (kpiCards[3]) kpiCards[3].querySelector('.kpi-value').textContent = monthKPIs.count;

  // Listener realtime para agendamentos do dia
  if (unsubscribeAdminAppts) unsubscribeAdminAppts();
  unsubscribeAdminAppts = onAllAppointments((appts) => {
    renderAdminAppointments(appts.filter(a => a.date === today));
  }, today);

  // Renderiza performance da equipe
  const adminDash = document.getElementById('screen-admin-dash');
  if (adminDash) {
    const weekly = Array.from(adminDash.querySelectorAll('.dash-card')).find(card =>
      card.querySelector('.dash-card-title')?.textContent.includes('Faturamento Semanal')
    );
    if (weekly) {
      weekly.innerHTML = `
        <div class="dash-card-title">Faturamento Semanal</div>
        <p style="color:var(--muted);line-height:1.8;padding:1rem 0 0;">Gráfico em revisão. Os números reais aparecem no resumo financeiro.</p>
      `;
    }
  }

  if (monthKPIs.barberRevenue) {
    const teamList = document.querySelector('.team-list');
    if (teamList) {
      teamList.innerHTML = Object.entries(monthKPIs.barberRevenue).map(([barberName, revenue]) => `
        <div class="team-row">
          <div class="team-avatar">${escapeHtml((barberName.match(/\b\w/g) || []).join('').slice(0, 2).toUpperCase())}</div>
          <div><div class="team-name">${escapeHtml(barberName)}</div><div class="team-role">Barbeiro</div></div>
          <div class="team-appts"><div style="font-size:0.65rem;color:var(--muted);">Fatur.</div>R$ ${escapeHtml(revenue.toFixed(0))}</div>
        </div>
      `).join('');
    }
  } else {
    const teamList = document.querySelector('.team-list');
    if (teamList) {
      teamList.innerHTML = '<p style="color: var(--muted); text-align:center; padding: 1.5rem;">Sem dados reais de equipe para exibir.</p>';
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
          <div class="appt-client">${escapeHtml(appt.clientName)}</div>
          <div class="appt-service">${escapeHtml(appt.serviceName)} · R$ ${escapeHtml(appt.servicePrice)}</div>
        </div>
        <div class="appt-status ${statusClass}">${translateStatus(appt.status)}</div>
      </div>
    `;
  }).join('');
}

// ════════════════════════════════════
async function showFinancePanel() {
  try {
    if (!appState.currentUser || !['admin', 'finance'].includes(appState.currentUser.role)) {
      showToast('âœ— Apenas administradores financeiros podem acessar o financeiro');
      return;
    }

    const today = formatToday();
    const yearMonth = today.slice(0, 7);
    const dayKPIs = await getDayKPIs(today);
    const monthKPIs = await getMonthKPIs(yearMonth);
    const topServicesEntries = Array.isArray(monthKPIs.topServices) ? monthKPIs.topServices : [];
    const barberRevenueEntries = Object.entries(monthKPIs.barberRevenue || {});

    const topServices = topServicesEntries.length
      ? topServicesEntries.map(([serviceName, count]) => `
          <div class="team-row">
            <div>
              <div class="team-name">${escapeHtml(serviceName)}</div>
              <div class="team-role">Serviço mais pedido</div>
            </div>
            <div class="team-appts">${escapeHtml(count)}x</div>
          </div>
        `).join('')
      : '<p style="color: var(--muted);">Sem dados suficientes no período.</p>';

    const root = document.getElementById('admin-main');
    if (!root) return;

    root.innerHTML = `
      <div class="dash-header">
        <div>
          <h1 class="dash-greeting">Financeiro</h1>
          <p class="dash-date">${formatTodayPtBr()} · Resumo do período ${yearMonth}</p>
        </div>
        <div style="display:flex;gap:0.8rem;flex-wrap:wrap;">
          <button class="btn-secondary" style="font-size:0.7rem;padding:0.55rem 1.1rem;" onclick="showScreen('admin-dash')">← Visão geral</button>
          <button class="btn-primary" style="font-size:0.7rem;padding:0.55rem 1.1rem;" onclick="exportAdminData()">Exportar</button>
        </div>
      </div>
      <div class="revenue-row">
        <div class="revenue-card"><div class="revenue-label">Faturamento do mês</div><div class="revenue-value">R$ ${monthKPIs.revenue.toFixed(2)}</div><div class="revenue-sub">${monthKPIs.count} atendimentos</div></div>
        <div class="revenue-card"><div class="revenue-label">Faturamento do dia</div><div class="revenue-value">R$ ${dayKPIs.revenue.toFixed(2)}</div><div class="revenue-sub">${dayKPIs.count} atendimentos</div></div>
        <div class="revenue-card"><div class="revenue-label">Ticket médio</div><div class="revenue-value">R$ ${monthKPIs.avgTicket.toFixed(2)}</div><div class="revenue-sub">Resumo do mês</div></div>
      </div>
      <div class="dash-grid">
        <div class="dash-card">
          <div class="dash-card-title">Top serviços</div>
          <div style="display:flex;flex-direction:column;gap:0.75rem;">${topServices}</div>
        </div>
        <div class="dash-card">
          <div class="dash-card-title">Exportação</div>
          <p style="color: var(--muted); line-height: 1.7;">
            O botão Exportar salva um snapshot mensal em <code>exports/${yearMonth.replace('-', '_')}</code> no Firestore.
          </p>
          <button class="btn-primary" onclick="exportAdminData()">Exportar mês atual</button>
        </div>
      </div>
      <div class="dash-card" style="margin-top:1.5rem;">
        <div class="dash-card-title">Resumo por barbeiro</div>
        <div class="team-list">
          ${barberRevenueEntries.length
            ? barberRevenueEntries.map(([barberName, revenue]) => `
                <div class="team-row">
                  <div class="team-avatar">${escapeHtml((barberName.match(/\b\w/g) || []).join('').slice(0, 2).toUpperCase())}</div>
                  <div>
                    <div class="team-name">${escapeHtml(barberName)}</div>
                    <div class="team-role">Faturamento no mês</div>
                  </div>
                  <div class="team-appts">R$ ${escapeHtml(revenue.toFixed(0))}</div>
                </div>
              `).join('')
            : '<p style="color: var(--muted); text-align:center; padding: 1.5rem;">Sem dados de faturamento por barbeiro no período.</p>'}
        </div>
      </div>
    `;
  } catch (e) {
    console.error('Erro ao carregar financeiro:', e);
    showToast('âœ— Não foi possível abrir o financeiro');
  }
}

window.showFinancePanel = showFinancePanel;

async function showServicesPanel() {
  try {
    if (!appState.currentUser || appState.currentUser.role !== 'admin') {
      showToast('âœ— Apenas administradores podem gerenciar serviços');
      return;
    }

    appState.adminServices = await getAllServices();
    appState.editingServiceId = null;

    const root = document.getElementById('admin-main');
    if (!root) return;

    root.innerHTML = `
      <div class="dash-header">
        <div>
          <h1 class="dash-greeting">Serviços</h1>
          <p class="dash-date">Gerencie catálogo, preços, duração e status de exibição</p>
        </div>
        <div style="display:flex;gap:0.8rem;flex-wrap:wrap;">
          <button class="btn-secondary" style="font-size:0.7rem;padding:0.55rem 1.1rem;" onclick="showScreen('admin-dash')">← Voltar</button>
          <button class="btn-primary" style="font-size:0.7rem;padding:0.55rem 1.1rem;" onclick="resetServiceForm()">Novo serviço</button>
        </div>
      </div>
      <div class="dash-grid">
        <div class="dash-card">
          <div class="dash-card-title" id="service-form-title">Novo serviço</div>
          <div style="display:grid;gap:0.85rem;">
            <div>
              <label class="form-label">Nome</label>
              <input id="service-name" class="form-input" type="text" placeholder="Corte Clássico" />
            </div>
            <div>
              <label class="form-label">Descrição</label>
              <textarea id="service-description" class="form-input" rows="3" placeholder="Descrição curta do serviço"></textarea>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.75rem;">
              <div>
                <label class="form-label">Preço</label>
                <input id="service-price" class="form-input" type="number" min="0" step="0.01" placeholder="50" />
              </div>
              <div>
                <label class="form-label">Duração (min)</label>
                <input id="service-duration" class="form-input" type="number" min="5" step="5" placeholder="30" />
              </div>
              <div>
                <label class="form-label">Ordem</label>
                <input id="service-order" class="form-input" type="number" min="1" step="1" placeholder="1" />
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:0.6rem;">
              <input id="service-active" type="checkbox" checked />
              <label for="service-active" class="form-label" style="margin:0;">Ativo na vitrine</label>
            </div>
            <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
              <button class="btn-primary" onclick="saveServiceFromForm()">Salvar serviço</button>
              <button class="btn-secondary" onclick="clearServiceForm()">Limpar</button>
            </div>
            <p style="color:var(--muted);font-size:0.78rem;line-height:1.6;">
              O ID do documento é gerado automaticamente a partir do nome, mas você pode editar o registro existente sem perder o vínculo do agendamento.
            </p>
          </div>
        </div>
        <div class="dash-card">
          <div class="dash-card-title">Catálogo atual</div>
          <div id="service-admin-list" style="display:flex;flex-direction:column;gap:0.8rem;"></div>
        </div>
      </div>
    `;

    renderServiceAdminList();
  } catch (e) {
    console.error('Erro ao abrir serviços:', e);
    showToast('âœ— Não foi possível abrir o painel de serviços');
  }
}

function renderServiceAdminList() {
  const list = document.getElementById('service-admin-list');
  if (!list) return;

  if (!appState.adminServices.length) {
    list.innerHTML = '<p style="color: var(--muted);">Nenhum serviço cadastrado ainda.</p>';
    return;
  }

  list.innerHTML = appState.adminServices.map(service => `
    <div class="team-row" style="align-items:flex-start;">
      <div style="min-width:0;">
        <div class="team-name">${escapeHtml(service.name)}</div>
        <div class="team-role">${escapeHtml(service.description || 'Sem descrição')}</div>
        <div style="font-size:0.72rem;color:var(--muted);margin-top:0.35rem;">
          ${escapeHtml(service.durationMinutes)} min · R$ ${escapeHtml(Number(service.price || 0).toFixed(2))} · ${service.active ? 'Ativo' : 'Inativo'}
        </div>
      </div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
        <button class="btn-secondary" style="font-size:0.68rem;padding:0.45rem 0.85rem;" onclick='editService(${JSON.stringify(service.id)})'>Editar</button>
        <button class="btn-secondary" style="font-size:0.68rem;padding:0.45rem 0.85rem;" onclick='removeService(${JSON.stringify(service.id)})'>Apagar</button>
      </div>
    </div>
  `).join('');
}

function clearServiceForm() {
  appState.editingServiceId = null;
  const fields = {
    name: document.getElementById('service-name'),
    description: document.getElementById('service-description'),
    price: document.getElementById('service-price'),
    duration: document.getElementById('service-duration'),
    order: document.getElementById('service-order'),
    active: document.getElementById('service-active'),
    title: document.getElementById('service-form-title')
  };

  if (fields.name) fields.name.value = '';
  if (fields.description) fields.description.value = '';
  if (fields.price) fields.price.value = '';
  if (fields.duration) fields.duration.value = '';
  if (fields.order) fields.order.value = '';
  if (fields.active) fields.active.checked = true;
  if (fields.title) fields.title.textContent = 'Novo serviço';
}

function fillServiceForm(service) {
  appState.editingServiceId = service.id;
  const name = document.getElementById('service-name');
  const description = document.getElementById('service-description');
  const price = document.getElementById('service-price');
  const duration = document.getElementById('service-duration');
  const order = document.getElementById('service-order');
  const active = document.getElementById('service-active');
  const title = document.getElementById('service-form-title');

  if (name) name.value = service.name || '';
  if (description) description.value = service.description || '';
  if (price) price.value = service.price ?? '';
  if (duration) duration.value = service.durationMinutes ?? '';
  if (order) order.value = service.order ?? '';
  if (active) active.checked = Boolean(service.active);
  if (title) title.textContent = `Editando: ${service.name || 'serviço'}`;
}

window.resetServiceForm = clearServiceForm;
window.clearServiceForm = clearServiceForm;
window.editService = function(serviceId) {
  const service = appState.adminServices.find(s => s.id === serviceId);
  if (!service) return;
  fillServiceForm(service);
};

window.removeService = async function(serviceId) {
  if (!confirm('Tem certeza que deseja apagar este serviço?')) return;

  try {
    await deleteService(serviceId);
    showToast('âœ“ Serviço apagado');
    appState.adminServices = appState.adminServices.filter(s => s.id !== serviceId);
    renderServiceAdminList();
    if (appState.editingServiceId === serviceId) {
      clearServiceForm();
    }
  } catch (e) {
    showToast('âœ— ' + e.message);
  }
};

window.saveServiceFromForm = async function() {
  try {
    if (!appState.currentUser || appState.currentUser.role !== 'admin') {
      showToast('âœ— Apenas administradores podem salvar serviços');
      return;
    }

    const payload = {
      name: document.getElementById('service-name')?.value,
      description: document.getElementById('service-description')?.value,
      price: document.getElementById('service-price')?.value,
      durationMinutes: document.getElementById('service-duration')?.value,
      order: document.getElementById('service-order')?.value,
      active: document.getElementById('service-active')?.checked
    };

    if (appState.editingServiceId) {
      await updateService(appState.editingServiceId, payload);
      showToast('âœ“ Serviço atualizado');
    } else {
      const result = await createService(payload);
      appState.editingServiceId = result.id;
      showToast('âœ“ Serviço criado');
    }

    appState.adminServices = await getAllServices();
    renderServiceAdminList();
    clearServiceForm();
    if (document.querySelector('#screen-booking.active')) {
      await initBookingScreen();
    }
  } catch (e) {
    showToast('âœ— ' + e.message);
  }
};

window.showServicesPanel = showServicesPanel;

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
  if (!canAccessScreen(name, appState.currentUser)) {
    if (!appState.authResolved) {
      showToast('Aguarde a verificação de acesso.');
      return;
    }
    showAccessDenied('Acesso restrito. Faça login com uma conta autorizada.');
    return;
  }

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
  } else if (name === 'landing') {
    renderLandingServices();
    renderLandingBarbers();
    syncRestrictedUi();
  }
}

// Expõe globalmente
window.showScreen = showScreen;
window.showToast = showToast;

// ════════════════════════════════════
// CALENDAR - GENERADOR DINÂMICO
// ════════════════════════════════════

/**
 * Estado do calendário para navegação entre meses
 */
let calendarState = {
  currentYear: null,
  currentMonth: null // 0-11
};

/**
 * Inicializa o calendário com o mês/ano atual
 */
function initCalendar() {
  const now = new Date();
  calendarState.currentYear = now.getFullYear();
  calendarState.currentMonth = now.getMonth();
  renderCalendar();
}

/**
 * Renderiza o calendário para o mês/ano atual no calendarState
 */
function renderCalendar() {
  const monthEl = document.getElementById('calendar-month-year');
  const daysContainer = document.querySelector('.cal-days');
  
  if (!monthEl || !daysContainer) return;
  
  const { currentYear, currentMonth } = calendarState;
  const settings = appState.businessSettings || {};
  
  // Nomes dos meses em português
  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  
  // Atualiza header do calendário
  monthEl.textContent = `${monthNames[currentMonth]} ${currentYear}`;
  
  // Calcula o primeiro dia do mês e quantos dias tem
  const firstDay = new Date(currentYear, currentMonth, 1);
  const lastDay = new Date(currentYear, currentMonth + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDay = firstDay.getDay(); // 0 = Domingo, 6 = Sábado
  
  // Data de hoje para marcar
  const today = new Date();
  const todayDay = today.getDate();
  const todayMonth = today.getMonth();
  const todayYear = today.getFullYear();
  const isCurrentMonth = currentMonth === todayMonth && currentYear === todayYear;
  const blockedWeekdays = new Set(getBusinessSettingList(settings.closedWeekdays).map(Number));
  const blockedDates = new Set(getBusinessSettingList(settings.blockedDates));
  const holidays = new Set(getBusinessSettingList(settings.holidays));
  const blockSunday = settings.blockSunday !== false;
  
  // Dias da semana (labels)
  const dayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  
  // Constrói o HTML do calendário
  let html = '';
  
  // Adiciona labels dos dias
  dayLabels.forEach(label => {
    html += `<div class="cal-day-label">${label}</div>`;
  });
  
  // Dias do mês anterior (preenchimento)
  const prevMonthLastDay = new Date(currentYear, currentMonth, 0).getDate();
  for (let i = startingDay - 1; i >= 0; i--) {
    html += `<div class="cal-day disabled">${prevMonthLastDay - i}</div>`;
  }
  
  // Dias do mês atual
  const todayObj = new Date();
  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(currentYear, currentMonth, day);
    const dayOfWeek = dateObj.getDay();
    const isToday = isCurrentMonth && day === todayDay;
    const isoDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isWeekend = dayOfWeek === 6 || (blockSunday && dayOfWeek === 0) || blockedWeekdays.has(dayOfWeek);
    const isPast = dateObj < new Date(todayObj.getFullYear(), todayObj.getMonth(), todayObj.getDate());
    const isBlocked = blockedDates.has(isoDate) || holidays.has(isoDate);
    
    let classes = 'cal-day';
    if (isToday) classes += ' today';
    if (isWeekend || isPast || isBlocked) classes += ' disabled';
    
    html += `<div class="${classes}" onclick="selectDay(this)">${day}</div>`;
  }
  
  // Dias do próximo mês (preenchimento para completar grade)
  const totalCells = startingDay + daysInMonth;
  const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let i = 1; i <= remainingCells; i++) {
    html += `<div class="cal-day disabled">${i}</div>`;
  }
  
  daysContainer.innerHTML = html;
}

/**
 * Navega para o mês anterior
 */
function calendarPrevMonth() {
  calendarState.currentMonth--;
  if (calendarState.currentMonth < 0) {
    calendarState.currentMonth = 11;
    calendarState.currentYear--;
  }
  renderCalendar();
}

/**
 * Navega para o próximo mês
 */
function calendarNextMonth() {
  calendarState.currentMonth++;
  if (calendarState.currentMonth > 11) {
    calendarState.currentMonth = 0;
    calendarState.currentYear++;
  }
  renderCalendar();
}

// ════════════════════════════════════
// INIT
// ════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  showScreen('landing');
  syncRestrictedUi();
  initAuth();
  initCalendar();
  window.addEventListener('load', () => {
    if (!appState.authResolved) {
      setAuthLoading(false);
    }
  });
  
  // Configura botões de navegação do calendário
  const calNavButtons = document.querySelectorAll('.cal-nav');
  if (calNavButtons.length >= 2) {
    calNavButtons[0].addEventListener('click', calendarPrevMonth);
    calNavButtons[1].addEventListener('click', calendarNextMonth);
  }
  
  // Renderiza barbeiros na landing page quando estiver na tela de landing
  if (document.getElementById('screen-landing')) {
    renderLandingServices();
    renderLandingBarbers();
    initFaqAccordion();
  }

  const galleryModal = document.getElementById('gallery-modal');
  if (galleryModal) {
    galleryModal.addEventListener('click', (event) => {
      if (event.target === galleryModal || event.target.classList.contains('gallery-modal-close')) {
        window.closeGalleryModal();
      }
    });
  }
});
