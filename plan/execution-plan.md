# Plano de Execução: Laboratório de Performance (URL Shortener)

## 📁 Estrutura Inicial do Projeto

Crie uma pasta para o projeto com a seguinte estrutura de arquivos:

```txt
url-shortener-lab/
├── backend/
│   ├── src/
│   │   ├── server.js
│   │   └── index.html
│   ├── package.json
│   └── Dockerfile
├── db/
│   └── init.sql
├── k6/
│   └── load-test.js
└── docker-compose.yml
```

## 🛠️ Passo 1: Configuração do Banco de Dados e Carga Inicial (Seed)

Para popular a tabela automaticamente no primeiro startup do PostgreSQL, utilizaremos o ponto de entrada oficial /docker-entrypoint-initdb.d/. O script abaixo gera 150 mil registros aleatórios eficientemente usando a função generate_series do Postgres.

```sql
-- db/init.sql
SQL
CREATE TABLE IF NOT EXISTS urls (
    id SERIAL PRIMARY KEY,
    long_url TEXT NOT NULL,
    short_url VARCHAR(10) NOT NULL
);

-- Popula o banco com 150.000 registros aleatórios para forçar o Sequential Scan (Full Table Scan)
INSERT INTO urls (long_url, short_url)
SELECT 
    'https://www.exemplo-de-url-longa-para-testar-o-banco-de-dados.com/path/' || md5(random()::text),
    substring(md5(random()::text) from 1 for 6)
FROM generate_series(1, 150000);

-- Insere uma URL específica no final para testarmos a busca lenta no pior cenário
INSERT INTO urls (long_url, short_url) 
VALUES ('https://nubank.com.br', 'nu9999');
```

## 💻 Passo 2: O Backend e Frontend Simplificado (Node.js)

Faremos uma aplicação Node.js minimalista usando o módulo nativo express e o driver pg. Para a Fase 1, simularemos o comportamento de abrir e fechar uma conexão por requisição (sem pooling).

```json
{
  "name": "url-shortener-backend",
  "version": "1.0.0",
  "main": "src/server.js",
  "dependencies": {
    "pg": "^8.11.0",
    "redis": "^4.6.0"
  }
}
````

Um HTML simples servido pelo próprio Node para testar visualmente se necessário.

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>Encurtador Local</title>
    <style>body { font-family: sans-serif; max-width: 500px; margin: 50px auto; padding: 20px; }</style>
</head>
<body>
    <h2>Encurtador de URL</h2>
    <form action="/shorten" method="POST">
        <input type="url" name="longUrl" placeholder="Digite a URL longa" required style="width: 70%; padding: 8px;">
        <button type="submit" style="padding: 8px;">Encurtar</button>
    </form>
</body>
</html>
```

```yaml
Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "src/server.js"]
```

## 🐋 Passo 3: Orquestração com Docker Compose

O `docker-compose.yml` vai gerenciar o ecossistema. O Redis já ficará declarado aqui, mas nas primeiras fases a aplicação simplesmente não irá se conectar a ele.

```yaml
version: '3.8'

services:
  postgres-db:
    image: postgres:15-alpine
    container_name: shortener-db
    environment:
      POSTGRES_USER: user_admin
      POSTGRES_PASSWORD: password123
      POSTGRES_DB: shortener_db
    ports:
      - "5432:5432"
    volumes:
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user_admin -d shortener_db"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis-cache:
    image: redis:7-alpine
    container_name: shortener-redis
    ports:
      - "6379:6379"

  app:
    build: ./backend
    container_name: shortener-app
    ports:
      - "3000:3000"
    environment:
      - DB_HOST=postgres-db
      - DB_USER=user_admin
      - DB_PASSWORD=password123
      - DB_NAME=shortener_db
      - REDIS_URL=redis://redis-cache:6379
      - ENABLE_POOLING=false
      - ENABLE_INDEX=false
      - ENABLE_CACHE=false
    depends_on:
      postgres-db:
        condition: service_healthy
```

## 📈 Passo 4: Cenário de Teste de Carga com k6

O k6 vai bater no endpoint de redirecionamento (GET /nu9999), forçando o banco a varrer os 150 mil registros sem índice para encontrar a última linha. Arquivo `k6/load-test.js` javascript com a lógica de execução do teste de carga:

```js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    vus: 50, // 50 usuários simultâneos
    duration: '30s', // Duração do teste
};

export default function () {
    // Busca a URL que inserimos propositalmente no final do seed
    const res = http.get('http://localhost:3000/nu9999');
    
    check(res, {
        'status é 200 ou 302': (r) => r.status === 200 || r.status === 302,
        'tempo de resposta < 200ms': (r) => r.timings.duration < 200,
    });
    
    sleep(0.1); // Pequena pausa entre requisições por VU
}
```

## 🚀 Execução do Laboratório (Passo a Passo no Terminal)

### Fase 0: Instalação do k6

Caso não tenha o k6 instalado localmente na sua máquina:

- macOS (Homebrew): `brew install k6`
- Linux (Ubuntu/Debian):

```sh
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

- Windows (Chocolatey): `choco install k6`

### 🚨 FASE 1: O Gargalo (Sem Índice, Sem Pooling, Sem Cache)

Objetivo: Replicar a lentidão extrema e o esgotamento de conexões.

Subir o ambiente:

```sh
docker-compose up --build -d
```

Verificar se os dados foram populados (opcional):

```sh
docker exec -it shortener-db psql -U user_admin -d shortener_db -c "SELECT COUNT(*) FROM urls;"
```

Executar o teste de carga:

```sh
k6 run k6/load-test.js
```

📝 Anote as métricas de http_req_duration (avg, p95) e a taxa de sucesso dos checks.

### ⚡ FASE 2: Adicionando o Índice no Banco

Objetivo: Eliminar o Sequential Scan no Postgres e transformá-lo em Index Scan.

Entrar no CLI do Postgres e criar o índice na coluna consultada:

```sh
docker exec -it shortener-db psql -U user_admin -d shortener_db -c "CREATE INDEX idx_urls_short_url ON urls(short_url);"
```

Rodar novamente o teste de carga:

```sh
k6 run k6/load-test.js
```

📝 Compare o http_req_duration. A melhora deve ser drástica (de segundos para milissegundos).

### 🔄 FASE 3: Implementando Connection Pooling

Objetivo: Evitar o overhead de abrir/fechar conexões TCP com o banco a cada requisição HTTP.

Altere a lógica do seu backend/src/server.js para utilizar new pg.Pool() em vez de new pg.Client() quando a variável de ambiente ENABLE_POOLING=true.

Atualizar a variável no docker-compose.yml:
Mude para - ENABLE_POOLING=true

Reiniciar a aplicação:

```sh
docker-compose up -d app
```

Rodar novamente o teste de carga:

```sh
k6 run k6/load-test.js
```

📝 Anote os novos resultados. O throughput (req/s) deve aumentar e o consumo de CPU do banco deve cair.

### 🚀 FASE 4: Cache com Redis

Objetivo: Nem sequer tocar no banco de dados para chaves que são acessadas frequentemente.

Altere o server.js para, antes de consultar o Postgres, fazer um client.get(shortUrl). Se encontrar (Cache Hit), responde imediatamente. Se não (Cache Miss), busca no banco e salva no Redis com client.set(shortUrl, longUrl, { EX: 3600 }).

Atualizar a variável no docker-compose.yml:
Mude para - ENABLE_CACHE=true

Reiniciar a aplicação:

```sh
docker-compose up -d app
```

Rodar novamente o teste de carga:

```sh
k6 run k6/load-test.js
```

📝 A primeira requisição de cada VU bate no banco, as subsequentes batem no Redis. O tempo de resposta deve cair para a casa de 1 a 3ms.