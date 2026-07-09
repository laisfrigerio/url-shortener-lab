const express = require('express');
const { Client, Pool } = require('pg');
const redis = require('redis');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const ENABLE_POOLING = process.env.ENABLE_POOLING === 'true';
const ENABLE_CACHE = process.env.ENABLE_CACHE === 'true';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'user_admin',
  password: process.env.DB_PASSWORD || 'password123',
  database: process.env.DB_NAME || 'shortener_db',
  port: 5432,
};

// Singleton do Pool (reutilizado entre requisições quando ENABLE_POOLING=true)
let pool;
if (ENABLE_POOLING) {
  pool = new Pool(dbConfig);
  console.log('[DB] Modo: Connection Pooling ativado (pg.Pool)');
} else {
  console.log('[DB] Modo: Sem pooling — nova conexão por requisição (pg.Client)');
}

// Cliente Redis (conectado apenas quando ENABLE_CACHE=true)
let redisClient;
if (ENABLE_CACHE) {
  redisClient = redis.createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  redisClient.on('error', (err) => console.error('[Redis] Erro:', err));
  redisClient.connect().then(() => console.log('[Redis] Cache ativado e conectado'));
} else {
  console.log('[Redis] Cache desativado');
}

// Helper: executa query sem pooling (abre e fecha conexão a cada vez)
async function queryWithoutPool(sql, params) {
  const client = new Client(dbConfig);
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

// Helper: executa query com ou sem pool dependendo da flag
async function query(sql, params) {
  if (ENABLE_POOLING) {
    return pool.query(sql, params);
  }
  return queryWithoutPool(sql, params);
}

// Serve o HTML de frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Encurta uma URL
app.post('/shorten', async (req, res) => {
  const { longUrl } = req.body;
  if (!longUrl) {
    return res.status(400).send('Campo longUrl é obrigatório');
  }

  const shortUrl = Math.random().toString(36).substring(2, 8);

  try {
    await query('INSERT INTO urls (long_url, short_url) VALUES ($1, $2)', [longUrl, shortUrl]);
    res.send(`URL encurtada: <a href="/${shortUrl}">/${shortUrl}</a>`);
  } catch (err) {
    console.error('[POST /shorten] Erro:', err.message);
    res.status(500).send('Erro ao encurtar URL');
  }
});

// Redireciona para a URL original
app.get('/:shortUrl', async (req, res) => {
  const { shortUrl } = req.params;

  try {
    // FASE 4: Tenta o cache antes de ir ao banco
    if (ENABLE_CACHE && redisClient) {
      const cached = await redisClient.get(shortUrl);
      if (cached) {
        console.log(`[Cache] HIT para "${shortUrl}"`);
        return res.redirect(cached);
      }
      console.log(`[Cache] MISS para "${shortUrl}" — consultando banco`);
    }

    // Consulta o banco (com ou sem pool, dependendo de ENABLE_POOLING)
    const result = await query('SELECT long_url FROM urls WHERE short_url = $1', [shortUrl]);

    if (result.rows.length === 0) {
      return res.status(404).send('URL não encontrada');
    }

    const longUrl = result.rows[0].long_url;

    // FASE 4: Armazena no cache para próximas requisições
    if (ENABLE_CACHE && redisClient) {
      await redisClient.set(shortUrl, longUrl, { EX: 3600 });
    }

    res.redirect(longUrl);
  } catch (err) {
    console.error(`[GET /${shortUrl}] Erro:`, err.message);
    res.status(500).send('Erro interno');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Server] Rodando na porta ${PORT}`);
  console.log(`[Flags] ENABLE_POOLING=${ENABLE_POOLING} | ENABLE_CACHE=${ENABLE_CACHE}`);
});
