# Central CRM - Grupo Central de Tintas

CRM Conversacional com integração WhatsApp (Z-API), IA (Claude) e ERP (VHSYS).

## Pré-requisitos

- Node.js >= 20
- Docker e Docker Compose
- Conta Z-API configurada
- Chave API Anthropic (Claude)
- Credenciais VHSYS

## Setup

```bash
# 1. Clone o repositório
git clone https://github.com/maickdamacenoalves-dot/central-crm.git
cd central-crm

# 2. Copie e configure as variáveis de ambiente
cp .env.example .env
# Edite o .env com suas credenciais

# 3. Suba os serviços (PostgreSQL + Redis)
docker compose up -d postgres redis

# 4. Instale as dependências
npm install

# 5. Gere o client Prisma e aplique o schema
npx prisma generate
npx prisma db push

# 6. Execute o seed (cria org, lojas, admin e atendentes)
npm run db:seed

# 7. Inicie o servidor em modo dev
npm run dev
```

## Estrutura

```
├── prisma/
│   ├── schema.prisma      # Modelos do banco
│   └── seed.js            # Dados iniciais
├── src/
│   ├── config/            # Env, Redis, Database
│   ├── middleware/         # Auth JWT
│   ├── queues/            # BullMQ queues e workers
│   ├── routes/            # Webhook, Auth, Health
│   ├── services/          # Message router, Z-API, Session
│   ├── utils/             # Logger, Crypto
│   └── server.js          # Entry point
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

## Lojas

| Loja | Localização |
|------|-------------|
| Central de Tintas Garopaba | Garopaba/SC |
| Central de Tintas Imbituba | Imbituba/SC |
| Central de Tintas Laguna | Laguna/SC |
| SW Garopaba | Garopaba/SC |
| Garopaba Tintas | Garopaba/SC |

## Endpoints

- `GET /health` - Health check (API + Postgres + Redis)
- `POST /webhook/zapi` - Recebe mensagens da Z-API
- `POST /auth/login` - Login
- `POST /auth/refresh` - Refresh token
- `POST /auth/logout` - Logout
- `GET /auth/me` - Dados do agente autenticado

## Admin padrão

- **Email:** maick@centraldetintas.com
- **Senha:** Admin@2025!
