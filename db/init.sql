-- db/init.sql
CREATE TABLE IF NOT EXISTS urls (
    id SERIAL PRIMARY KEY,
    long_url TEXT NOT NULL,
    short_url VARCHAR(10) NOT NULL
);

-- Popula o banco com 150.000 registros aleatórios para forçar o Sequential Scan (Full Table Scan)
INSERT INTO urls (long_url, short_url)
SELECT 
    'https://laisfrigerio.com.br/link-da-bio/' || md5(random()::text),
    substring(md5(random()::text) from 1 for 6)
FROM generate_series(1, 150000);

-- Insere uma URL específica no final para testarmos a busca lenta no pior cenário
INSERT INTO urls (long_url, short_url) 
VALUES ('https://nubank.com.br', 'nu9999');
