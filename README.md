# Jodi's Barbershop

Sistema moderno de agendamento online para barbearias, desenvolvido com HTML, CSS, JavaScript e Firebase.

## Visão Geral

A Jodi's Barbershop é uma plataforma criada para modernizar o processo de atendimento e agendamento de clientes, reduzindo a dependência de WhatsApp e Instagram para marcação de horários e proporcionando uma experiência mais profissional para clientes e colaboradores.

### Principais Benefícios

* Agendamento online 24 horas por dia
* Redução do volume de mensagens no WhatsApp
* Organização automática da agenda
* Controle de disponibilidade dos barbeiros
* Evita conflitos e sobreposição de horários
* Dashboard administrativo
* Dashboard individual para barbeiros
* Integração com Firebase Authentication
* Integração com Firestore Database
* Design premium responsivo
* Preparado para estratégias de fidelização

---

## Tecnologias

### Frontend

* HTML5
* CSS3
* JavaScript (Vanilla)

### Backend

* Firebase Authentication
* Cloud Firestore

### Hospedagem

* GitHub Pages

---

## Estrutura do Projeto

```text
JODIS_BARBER_SHOP/

├── index.html
├── app.js
├── firebase-config.js
├── firebase-service.js
├── firestore.rules
├── manifest.json
│
├── assets/
│   ├── imagens
│   ├── ícones
│   ├── vídeos
│   └── logos
│
└── README.md
```

---

## Funcionalidades

### Cliente

* Visualização dos serviços
* Visualização dos barbeiros
* Galeria da barbearia
* Agendamento online
* Escolha de serviço
* Escolha de barbeiro
* Escolha de data e horário
* Confirmação de agendamento

### Barbeiro

* Login seguro
* Visualização da agenda do dia
* Atualização de status dos atendimentos
* Histórico de atendimentos
* Controle de clientes

### Administrador

* Gestão de barbeiros
* Gestão de serviços
* Gestão de agendamentos
* Controle financeiro
* Relatórios operacionais
* Exportação de dados

---

## Estrutura do Firestore

### settings

```javascript
settings/business
```

Exemplo:

```javascript
{
  openHour: "09:00",
  closeHour: "18:00",
  slotIntervalMinutes: 30,
  timezone: "America/Sao_Paulo"
}
```

---

### services

```javascript
services/{serviceId}
```

Exemplo:

```javascript
{
  name: "Corte Clássico",
  price: 60,
  durationMinutes: 30,
  active: true
}
```

---

### barbers

```javascript
barbers/{barberId}
```

Exemplo:

```javascript
{
  name: "Jodi",
  active: true,
  roleTitle: "Master Barber"
}
```

---

### appointments

```javascript
appointments/{appointmentId}
```

Exemplo:

```javascript
{
  clientName: "João",
  clientPhone: "(11)99999-9999",
  serviceName: "Corte Clássico",
  barberName: "Jodi",
  date: "2026-06-14",
  time: "15:00",
  status: "confirmed"
}
```

---

### users

```javascript
users/{uid}
```

Exemplo:

```javascript
{
  name: "Jodi",
  email: "joi@jodis.com",
  role: "barber",
  active: true,
  barberId: "jodi"
}
```

---

## Segurança

O projeto utiliza:

* Firebase Authentication
* Firestore Security Rules
* Controle por roles:

  * admin
  * barber
  * finance

Permissões são controladas tanto no frontend quanto nas regras do Firestore.

---

## Fidelização de Clientes

O sistema foi projetado para suportar futuras funcionalidades de retenção:

* Cupons promocionais
* Desconto para primeiro agendamento
* Programa de selos
* Cashback
* Benefícios por recorrência
* Campanhas sazonais

---

## Roadmap

### Em desenvolvimento

* Calendário dinâmico completo
* Integração WhatsApp
* Dashboard financeiro avançado
* Exportação CSV
* Google Reviews
* Programa de fidelidade
* Notificações automáticas

---

## Performance

Metas do projeto:

* Lighthouse Performance > 95
* Lighthouse SEO > 95
* Lighthouse Accessibility > 95
* Lighthouse Best Practices > 95

---

## Licença

Projeto privado desenvolvido para uso da Jodi's Barbershop.

Todos os direitos reservados.
