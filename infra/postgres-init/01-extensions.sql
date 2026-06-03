-- Habilita extensões necessárias no banco recém-criado.
-- Executado automaticamente pelo entrypoint da imagem postgres na primeira subida.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "vector";
