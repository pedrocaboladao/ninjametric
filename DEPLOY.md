# Deploy em produção (VPS)

Guia para colocar o Painel de Vendas no ar num VPS (ex: Hostinger KVM 1), usando
Docker para a aplicação (Postgres + backend + frontend) e Nginx do próprio
servidor só para HTTPS e roteamento do domínio.

## 1. Pré-requisitos no VPS

- Ubuntu 22.04 (ou similar)
- Um domínio (ou subdomínio) apontando o DNS (registro A) para o IP do VPS —
  ex: `painel.seudominio.com.br`

Instalar Docker e Nginx:

```bash
apt update && apt install -y docker.io docker-compose-plugin nginx certbot python3-certbot-nginx
systemctl enable --now docker
```

## 2. Clonar o projeto e configurar variáveis

```bash
git clone <url-do-repositorio> painel-vendas
cd painel-vendas
cp .env.example .env
```

Edite o `.env` preenchendo:
- `POSTGRES_PASSWORD` — uma senha forte
- `ML_CLIENT_ID` / `ML_CLIENT_SECRET` — do app no Mercado Livre Developers
- `ML_REDIRECT_URI` — `https://painel.seudominio.com.br/auth/callback`
- `VITE_API_BASE_URL` — `https://painel.seudominio.com.br`

## 3. Subir os containers

```bash
docker compose up -d --build
docker compose exec backend node dist/db/migrate.js
docker compose exec backend node dist/db/seed.js
```

Isso deixa o backend escutando em `127.0.0.1:4000` e o frontend em
`127.0.0.1:8080` — ainda não expostos publicamente, só o Nginx do host vai
expô-los via HTTPS.

## 4. Configurar o Nginx do host (proxy + HTTPS)

Crie `/etc/nginx/sites-available/painel`:

```nginx
server {
  listen 80;
  server_name painel.seudominio.com.br;

  location /auth/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
  }

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
  }
}
```

```bash
ln -s /etc/nginx/sites-available/painel /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d painel.seudominio.com.br
```

O certbot já ajusta o bloco `server` para HTTPS automaticamente e configura a
renovação automática do certificado.

## 5. Atualizar o app no Mercado Livre Developers

No painel do app, atualize a **Redirect URI** para o valor definitivo:
`https://painel.seudominio.com.br/auth/callback` (sem precisar mais de ngrok).

## 6. Reautorizar as 4 lojas

Acesse, uma vez para cada loja (troque o número 1-4), logado na conta certa:

```
https://painel.seudominio.com.br/auth/1/authorize
https://painel.seudominio.com.br/auth/2/authorize
https://painel.seudominio.com.br/auth/3/authorize
https://painel.seudominio.com.br/auth/4/authorize
```

## Atualizando o sistema depois

```bash
git pull
docker compose up -d --build
```

Os dados do Postgres ficam no volume `db_data` e não são perdidos entre
atualizações.
