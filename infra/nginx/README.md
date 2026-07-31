# Proxy reverso (nginx) — Collab

Dois hosts servidos por este nginx, ambos com TLS:

| Hostname | Encaminha para | Processo |
|---|---|---|
| `collab.unifique.com.br` | `127.0.0.1:13000` | web (Next.js) |
| `api-collab.unifique.com.br` | `127.0.0.1:13001` | API (NestJS) |

> **Por que os dois precisam de DNS:** o front é uma SPA — o **navegador** do usuário chama a API direto (via `NEXT_PUBLIC_API_BASE_URL=https://api-collab.unifique.com.br`). Logo, o navegador precisa resolver os dois hostnames. Os *processos* podem ficar presos em `127.0.0.1` (não expostos); quem é público é este nginx.

---

## 1. Pré-requisitos

- DNS: `collab.unifique.com.br` e `api-collab.unifique.com.br` apontando para o IP do servidor.
- App rodando localmente no servidor: `pnpm dev` (ou `pnpm build && pnpm start`) — web em `:13000`, API em `:13001`.
- nginx instalado (`sudo apt install nginx`).

## 2. Instalar a config

```bash
sudo cp infra/nginx/collab.conf /etc/nginx/sites-available/collab.conf
sudo ln -s /etc/nginx/sites-available/collab.conf /etc/nginx/sites-enabled/
sudo nginx -t                       # valida sintaxe
sudo systemctl reload nginx
```

## 3. Certificado TLS — escolha UMA opção

### Opção A — Let's Encrypt (grátis, automático) — recomendado se os domínios são acessíveis pela internet
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d collab.unifique.com.br -d api-collab.unifique.com.br
```
O certbot edita o nginx e configura a renovação automática. Os caminhos `ssl_certificate` no `collab.conf` já apontam para o padrão do Let's Encrypt (`/etc/letsencrypt/live/.../fullchain.pem`).
> Se os domínios **não** são acessíveis da internet (rede interna), use o desafio **DNS-01**: `sudo certbot certonly --manual --preferred-challenges dns -d ...` (ou o plugin de DNS do seu provedor).

### Opção B — Certificado próprio da Unifique (ex.: wildcard `*.unifique.com.br`)
Copie os arquivos para o servidor e ajuste no `collab.conf` (nos dois `server` 443):
```nginx
ssl_certificate     /etc/ssl/unifique/fullchain.pem;   # cert + cadeia intermediária
ssl_certificate_key /etc/ssl/unifique/privkey.pem;
```
Um wildcard `*.unifique.com.br` cobre os **dois** hostnames, porque `collab` e `api-collab` são ambos de 1º nível — foi exatamente por isso que o hostname da API ficou `api-collab` (com hífen) em vez de `api.collab`, que seria de 2º nível e exigiria um segundo wildcard `*.collab.unifique.com.br` ou SANs explícitos.

### Opção C — Self-signed (só para TESTAR agora, antes do cert real)
```bash
sudo mkdir -p /etc/ssl/collab
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/collab/privkey.pem \
  -out   /etc/ssl/collab/fullchain.pem \
  -subj "/CN=collab.unifique.com.br" \
  -addext "subjectAltName=DNS:collab.unifique.com.br,DNS:api-collab.unifique.com.br"
```
Aponte os dois `server` 443 para esses arquivos. O navegador vai avisar que o cert não é confiável (esperado em self-signed) — só para validação interna.

## 4. Conferir

```bash
curl -kI https://collab.unifique.com.br          # front (200/307)
curl -k  https://api-collab.unifique.com.br/health # {"status":"ok",...}
```

---

## Notas

- **CORS:** a API só aceita a origem `FRONTEND_ORIGIN=https://collab.unifique.com.br` (definido no `.env`). Se mudar o domínio do front, atualize lá.
- **Azure AD / Google OAuth:** registre os redirects nos portais:
  - Entra ID → redirect `https://collab.unifique.com.br`
  - Google → redirect `https://api-collab.unifique.com.br/auth/google/callback`
- **Endurecer (opcional):** se o nginx roda no mesmo host da app, prenda os processos em `127.0.0.1` para não expor as portas na rede:
  - API: em `apps/api/src/main.ts`, `await app.listen(port, '127.0.0.1')`.
  - Web: `next start -p 13000 -H 127.0.0.1`.
  Faça isso **apenas** se nginx e app estiverem na mesma máquina.
- **Webhooks:** o `proxy_request_buffering off` + `proxy_pass` preservam o body bruto que a API usa para validar HMAC em `/webhooks/gupy`. Não adicione módulos que reescrevam o corpo.
