# Firebase Integration Checklist

## 1️⃣ SETUP FIREBASE CONSOLE

- [ ] Crie projeto no [Firebase Console](https://console.firebase.google.com/)
- [ ] Ative **Authentication** → Email/Password
- [ ] Ative **Firestore Database** → São Paulo (southamericaeast1)
- [ ] Na aba **Project Settings**, copie a configuração web
- [ ] Copie os 7 valores (apiKey, authDomain, projectId, etc)

## 2️⃣ CLONE OS DADOS INICIAIS

No Firestore, crie manualmente (ou via admin SDK):

**users/ADMIN_UID:**
```json
{
  "active": true,
  "barberId": "",
  "createdAt": timestamp,
  "email": "admin@jodis.com",
  "name": "Admin Jodi's",
  "role": "admin"
}
```

**users/BARBER_UID:**
```json
{
  "active": true,
  "barberId": "jodi",
  "createdAt": timestamp,
  "email": "jodi@jodis.com",
  "name": "Jodi",
  "role": "barber"
}
```

**barbers/jodi:**
```json
{
  "name": "Jodi",
  "roleTitle": "Master Barber",
  "avatarInitials": "JD",
  "rating": 4.9,
  "active": true,
  "userId": "BARBER_UID",
  "createdAt": timestamp
}
```

**services/corte-classico, barba-completa, etc:** (conforme spec)

**settings/business:**
```json
{
  "openHour": "09:00",
  "closeHour": "18:00",
  "slotIntervalMinutes": 30,
  "openDays": [1, 2, 3, 4, 5, 6]
}
```

## 3️⃣ ATUALIZE firebase-config.js

```bash
# Abra firebase-config.js e substitua:
apiKey: "SUA_API_KEY",
authDomain: "seu-projeto.firebaseapp.com",
projectId: "seu-projeto",
storageBucket: "seu-projeto.appspot.com",
messagingSenderId: "123456789",
appId: "1:123456789:web:abc123def456",
measurementId: "G-XXXXXXXXXX"
```

## 4️⃣ UPLOAD DOS ARQUIVOS

Verifyque que estes 4 arquivos estão na raiz ao lado do indexJodi.html:

```
indexJodi.html          ← atualizado com IDs nos inputs
firebase-config.js      ← com seus valores do Firebase Console
firebase-service.js     ← código de integração
app.js                  ← lógica da aplicação
firestore.rules         ← regras (para colar no console)
```

## 5️⃣ CONFIGURE FIRESTORE RULES

No Firebase Console:
- [ ] Vá para **Firestore** → **Rules**
- [ ] Copie todo o conteúdo de `firestore.rules`
- [ ] Cole e clique **Publish**

## 6️⃣ CONFIGURE AUTH USERS

No Firebase Console → **Authentication**:
- [ ] Crie usuário admin@jodis.com com qualquer senha
- [ ] Crie usuário jodi@jodis.com com qualquer senha
- [ ] Copie os UIDs desses usuários
- [ ] Cole nos documentos users/{uid} que criou no Firestore

---

## ✅ CHECKLIST DE TESTES

### 🏠 LANDING PAGE
- [ ] Abre sem erros no console
- [ ] Carrossel funciona
- [ ] Botões "Reservar Horário" levam ao agendamento
- [ ] Design está preservado (cores, fontes, layout)

### 📅 AGENDAMENTO
- [ ] Clica em "Agendar" → carrega serviços do Firestore
- [ ] Serviços aparecem com preço e duração reais
- [ ] Barbeiros aparecem com rating reais
- [ ] Seleciona serviço → retém seleção
- [ ] Seleciona barbeiro → retém seleção
- [ ] Seleciona data → carrega horários dos settings
- [ ] Horários ocupados aparecem desabilitados (unavailable)
- [ ] Informações do cliente são obrigatórias
- [ ] Clica confirmar → cria em appointments/{appointmentId}
- [ ] Se repetir horário/barbeiro/data → erro "Horário já ocupado"
- [ ] Sucesso → volta para landing

### 🔐 LOGIN BARBEIRO
- [ ] Abre tela de login
- [ ] Clica em "Barbeiro" (tab ativo)
- [ ] Insere jodi@jodis.com + senha correta
- [ ] Clica entrar → dashboard barbeiro carrega
- [ ] Mostra nome "Jodi" no sidebar e greeting
- [ ] Carrega agendamentos de hoje (realtime from Firestore)
- [ ] Pode trocar status: confirmed → in_progress → done → canceled
- [ ] Atualização de status é imediata no Firestore

### 🔐 LOGIN ADMIN
- [ ] Clica em "Admin" (tab)
- [ ] Insere admin@jodis.com + senha correta
- [ ] Dashboard admin abre
- [ ] Mostra KPIs: faturamento do mês, atendimentos, ticket médio
- [ ] Lista barbers e performance deles
- [ ] Mostra agendamentos do dia
- [ ] Serviços mais vendidos aparecem com porcentagem

### 🔐 AUTH GUARDS
- [ ] Admin não pode acessar barber-dash direto (redireciona)
- [ ] Barbeiro não pode acessar admin-dash
- [ ] Deslogado não pode acessar nenhum dashboard
- [ ] Botão Sair no sidebar redireciona para login

### 📱 RESPONSIVO
- [ ] Mobile (320px): Menu hamburger funciona, layout se adapta
- [ ] Tablet (768px): Dashboard sidebar vira horizontal
- [ ] Desktop (1400px): Layout 2-col funciona

### 🎨 VISUAL
- [ ] Nenhuma cor foi alterada (gold, black, white mantidas)
- [ ] Fontes (Playfair, Barlow) carregam corretamente
- [ ] Loading state discreto (botão fica opaco)
- [ ] Toast aparece no canto inferior direito
- [ ] Transições de fade ainda funcionam

### 🔌 FIRESTORE
- [ ] Abre DevTools → Network → nenhum erro 403/401 em read/write válidas
- [ ] Firestore diz dados foram salvos (check no console.log ou tab "Studio")
- [ ] Realtime listeners funcionam (mudança no Firestore → UI atualiza)
- [ ] Transactions funcionam (horário não pode ser reservado 2x)

### 💾 GITHUB PAGES
- [ ] Faz deploy via GitHub
- [ ] URLs do CDN Firebase são acessíveis
- [ ] Assets (videos, pngs) carregam conforme path
- [ ] Acessa site do browser: https://seu-usuario.github.io/Jodis_Barber_System/

---

## 🆘 TROUBLESHOOTING

### "Uncaught TypeError: Cannot read property 'firebaseApp' of undefined"
→ Firebase CDN não carregou. Verifique internet e URL do CDN no HTML.

### "Permission denied" ao salvar agendamento
→ Firestore rules estão erradas ou não publicadas. Republique rules.

### "User not found in database"  
→ UID no auth não bate com UID no users/{uid}. Copie UID exato do console.

### Horários sempre "unavailable"
→ Nenhum slot foi marcado como disponível. Verifique settings/business.openHour e closeHour.

### Dashboard não carrega dados
→ Listener realtime não ativou. Cheque erro no console e regras Firestore.

### Agendamento duplicado é permitido
→ Transaction não funcionou. Firestore rules precisam bloquear.

---

## 📞 SUPORTE

Se algum passo falhar:
1. Abra DevTools → Console (F12)
2. Note exato a mensagem de erro
3. Tente novamente com valores correctos
4. Se persistir, revisite esse checklist
