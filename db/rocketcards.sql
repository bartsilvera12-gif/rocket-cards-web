-- Rocket Cards — base de datos
--
--   psql -U postgres -f db/rocketcards.sql
--
-- Crea la base "rocketcards" con todo su esquema. Es idempotente: se puede
-- volver a correr sin romper nada.
--
-- La idea de fondo: la tienda NO consulta la base en cada visita. El servidor
-- lee el catálogo una vez, lo guarda en memoria y lo vuelve a leer SÓLO cuando
-- Postgres le avisa que algo cambió, por el canal 'rocketcards' (LISTEN/NOTIFY).
-- Mil visitas por minuto con el catálogo quieto son cero consultas a la base.
--
-- El aviso se emite una sola vez por transacción, aunque se toquen cien filas:
-- ver rc_avisar_cambio() más abajo.

SELECT 'CREATE DATABASE rocketcards'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'rocketcards')\gexec

\connect rocketcards

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- Rol de la aplicación
-- ─────────────────────────────────────────────────────────────────────────
-- Nace SIN contraseña, así no puede conectarse hasta que le pongas una. Es a
-- propósito: un rol con contraseña escrita en un archivo del repo es un rol
-- público. Al terminar este script:
--
--   ALTER ROLE rocketcards_app PASSWORD 'la-que-elijas';
--
-- y la misma en DATABASE_URL del servidor.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rocketcards_app') THEN
    CREATE ROLE rocketcards_app LOGIN;
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Versión del catálogo
-- ─────────────────────────────────────────────────────────────────────────
-- Una sola fila. Sube de a uno cada vez que cambia algo que la tienda muestra.
-- El servidor la usa como ETag: si el navegador ya tiene esa versión, le
-- responde 304 sin mirar la base ni mandar el catálogo de nuevo.
--
-- El CHECK (id) con DEFAULT true es el truco para que la tabla no pueda tener
-- más de una fila: la clave primaria sólo admite el valor true.

CREATE TABLE IF NOT EXISTS rc_version (
  id              boolean     PRIMARY KEY DEFAULT true CHECK (id),
  version         bigint      NOT NULL DEFAULT 1,
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO rc_version (id) VALUES (true) ON CONFLICT DO NOTHING;

COMMENT ON TABLE rc_version IS
  'Fila única. Se incrementa una vez por transacción que modifique el catálogo.';

-- ─────────────────────────────────────────────────────────────────────────
-- Categorías
-- ─────────────────────────────────────────────────────────────────────────
-- "key" es la que aparece en la URL: /catalogo/sobres.

CREATE TABLE IF NOT EXISTS categoria (
  key             text        PRIMARY KEY CHECK (key ~ '^[a-z0-9][a-z0-9-]*$'),
  nombre          text        NOT NULL CHECK (nombre <> ''),
  kicker          text        NOT NULL DEFAULT '',
  nota            text        NOT NULL DEFAULT '',
  nota_menu       text        NOT NULL DEFAULT '',
  accent          text        NOT NULL DEFAULT '#E30613'
                              CHECK (accent ~ '^#[0-9A-Fa-f]{6}$'),
  img             text        NOT NULL DEFAULT '',
  orden           integer     NOT NULL DEFAULT 0,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS categoria_orden_idx ON categoria (orden, key);

-- ─────────────────────────────────────────────────────────────────────────
-- Productos
-- ─────────────────────────────────────────────────────────────────────────
-- El id es el SKU y se muestra en el buscador, así que conviene que se lea.
-- Los precios van en guaraníes enteros: no hay centavos, y bigint evita el
-- redondeo de los flotantes en cualquier suma.

CREATE TABLE IF NOT EXISTS producto (
  id              text        PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
  nombre          text        NOT NULL CHECK (nombre <> ''),
  coleccion       text        NOT NULL DEFAULT '',   -- "set" en la página
  categoria       text        NOT NULL REFERENCES categoria (key)
                              ON UPDATE CASCADE ON DELETE RESTRICT,
  img             text        NOT NULL DEFAULT '',
  precio          bigint      NOT NULL CHECK (precio >= 0),
  precio_anterior bigint      CHECK (precio_anterior IS NULL OR precio_anterior > precio),
  stock           integer     NOT NULL DEFAULT 0 CHECK (stock >= 0),
  etiqueta        text        CHECK (etiqueta IS NULL OR etiqueta <> ''),
  premium         boolean     NOT NULL DEFAULT false,
  nuevo_orden     integer,    -- posición en "Nuevos ingresos"; NULL = no sale ahí
  publicado       boolean     NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS producto_categoria_idx
  ON producto (categoria) WHERE publicado;

-- Parcial y único: dos productos no pueden pelearse el mismo lugar del
-- carrusel, y los que no están en "Nuevos ingresos" (NULL) no ocupan índice.
CREATE UNIQUE INDEX IF NOT EXISTS producto_nuevo_orden_idx
  ON producto (nuevo_orden) WHERE nuevo_orden IS NOT NULL;

COMMENT ON COLUMN producto.precio_anterior IS
  'Precio tachado. Si está, el producto sale en Ofertas y se calcula el % de descuento.';
COMMENT ON COLUMN producto.nuevo_orden IS
  'Posición en el carrusel "Nuevos ingresos". NULL = no aparece.';

-- ─────────────────────────────────────────────────────────────────────────
-- Administradores y sesiones
-- ─────────────────────────────────────────────────────────────────────────
-- El hash lo calcula el servidor con scrypt (nativo de Node, sin dependencias)
-- y se guarda como "scrypt$N$r$p$salt$hash". Acá nunca entra una contraseña
-- en claro.

CREATE TABLE IF NOT EXISTS admin (
  id              integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario         text        NOT NULL UNIQUE
                              CHECK (usuario = lower(usuario) AND length(usuario) >= 3),
  hash            text        NOT NULL,
  nombre          text        NOT NULL DEFAULT '',
  rol             text        NOT NULL DEFAULT 'editor'
                              CHECK (rol IN ('dueno', 'editor')),
  activo          boolean     NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  ultimo_acceso   timestamptz
);

COMMENT ON COLUMN admin.rol IS
  'dueno: puede todo, incluso administrar usuarios. editor: sólo catálogo.';

CREATE TABLE IF NOT EXISTS sesion (
  id          text        PRIMARY KEY,          -- 32 bytes al azar, en hex
  admin_id    integer     NOT NULL REFERENCES admin (id) ON DELETE CASCADE,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  expira_en   timestamptz NOT NULL,
  ip          inet,
  agente      text
);

CREATE INDEX IF NOT EXISTS sesion_expira_idx ON sesion (expira_en);

-- ─────────────────────────────────────────────────────────────────────────
-- Auditoría
-- ─────────────────────────────────────────────────────────────────────────
-- Quién tocó qué. El servidor declara quién está logueado con
-- SET LOCAL rocketcards.admin = '<id>' antes de escribir; si no lo declara,
-- queda NULL y se ve igual que el cambio pasó.

CREATE TABLE IF NOT EXISTS auditoria (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tabla       text        NOT NULL,
  registro_id text        NOT NULL,
  accion      text        NOT NULL CHECK (accion IN ('alta', 'cambio', 'baja')),
  antes       jsonb,
  despues     jsonb,
  admin_id    integer     REFERENCES admin (id) ON DELETE SET NULL,
  creado_en   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auditoria_creado_idx ON auditoria (creado_en DESC);
CREATE INDEX IF NOT EXISTS auditoria_registro_idx ON auditoria (tabla, registro_id);

-- ─────────────────────────────────────────────────────────────────────────
-- El aviso: un solo NOTIFY por transacción
-- ─────────────────────────────────────────────────────────────────────────
-- Si el admin corrige el stock de cuarenta productos en una sola operación,
-- esto manda UN aviso, no cuarenta. La marca se guarda con set_config(...,
-- true): ese "true" la hace local a la transacción, así que se borra sola al
-- terminar, haya COMMIT o ROLLBACK.
--
-- El NOTIFY viaja recién en el COMMIT, así que el que escucha nunca ve un
-- cambio que después se revirtió.

CREATE OR REPLACE FUNCTION rc_avisar_cambio() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v bigint;
BEGIN
  IF current_setting('rocketcards.avisado', true) = txid_current()::text THEN
    RETURN NULL;                      -- ya avisamos en esta transacción
  END IF;
  PERFORM set_config('rocketcards.avisado', txid_current()::text, true);

  UPDATE rc_version
     SET version = version + 1, actualizado_en = now()
   WHERE id
  RETURNING version INTO v;

  PERFORM pg_notify('rocketcards', json_build_object(
    'tipo',    'recargar',
    'version', v,
    'tabla',   TG_TABLE_NAME,
    'en',      to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )::text);

  RETURN NULL;
END
$$;

COMMENT ON FUNCTION rc_avisar_cambio() IS
  'Sube rc_version y manda un NOTIFY por el canal rocketcards. Una vez por transacción.';

CREATE OR REPLACE FUNCTION rc_marcar_fecha() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END
$$;

-- La auditoría sí es por fila: interesa el detalle de cada uno.
-- El nombre de la columna clave llega como argumento del trigger, porque no
-- es el mismo en las dos tablas: producto.id y categoria.key.
CREATE OR REPLACE FUNCTION rc_auditar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  quien  integer := nullif(current_setting('rocketcards.admin', true), '')::integer;
  clave  text    := TG_ARGV[0];
  nuevo  jsonb   := to_jsonb(NEW);
  viejo  jsonb   := to_jsonb(OLD);
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO auditoria (tabla, registro_id, accion, despues, admin_id)
    VALUES (TG_TABLE_NAME, nuevo ->> clave, 'alta', nuevo, quien);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF nuevo = viejo THEN
      RETURN NEW;                     -- un UPDATE que no cambió nada no es noticia
    END IF;
    INSERT INTO auditoria (tabla, registro_id, accion, antes, despues, admin_id)
    VALUES (TG_TABLE_NAME, nuevo ->> clave, 'cambio', viejo, nuevo, quien);
    RETURN NEW;
  ELSE
    INSERT INTO auditoria (tabla, registro_id, accion, antes, admin_id)
    VALUES (TG_TABLE_NAME, viejo ->> clave, 'baja', viejo, quien);
    RETURN OLD;
  END IF;
END
$$;

COMMIT;

-- Los triggers van fuera del BEGIN de arriba para poder recrearlos sueltos.
-- DROP + CREATE porque CREATE TRIGGER IF NOT EXISTS no existe en Postgres.

DROP TRIGGER IF EXISTS producto_fecha ON producto;
CREATE TRIGGER producto_fecha
  BEFORE UPDATE ON producto
  FOR EACH ROW EXECUTE FUNCTION rc_marcar_fecha();

DROP TRIGGER IF EXISTS categoria_fecha ON categoria;
CREATE TRIGGER categoria_fecha
  BEFORE UPDATE ON categoria
  FOR EACH ROW EXECUTE FUNCTION rc_marcar_fecha();

DROP TRIGGER IF EXISTS producto_auditar ON producto;
CREATE TRIGGER producto_auditar
  AFTER INSERT OR UPDATE OR DELETE ON producto
  FOR EACH ROW EXECUTE FUNCTION rc_auditar('id');

DROP TRIGGER IF EXISTS categoria_auditar ON categoria;
CREATE TRIGGER categoria_auditar
  AFTER INSERT OR UPDATE OR DELETE ON categoria
  FOR EACH ROW EXECUTE FUNCTION rc_auditar('key');

-- FOR EACH STATEMENT, no FOR EACH ROW: un UPDATE de cien filas entra acá una
-- sola vez, y la marca de transacción se encarga del resto.
DROP TRIGGER IF EXISTS producto_avisar ON producto;
CREATE TRIGGER producto_avisar
  AFTER INSERT OR UPDATE OR DELETE ON producto
  FOR EACH STATEMENT EXECUTE FUNCTION rc_avisar_cambio();

DROP TRIGGER IF EXISTS categoria_avisar ON categoria;
CREATE TRIGGER categoria_avisar
  AFTER INSERT OR UPDATE OR DELETE ON categoria
  FOR EACH STATEMENT EXECUTE FUNCTION rc_avisar_cambio();

-- ─────────────────────────────────────────────────────────────────────────
-- El catálogo, en una sola consulta
-- ─────────────────────────────────────────────────────────────────────────
-- Devuelve exactamente lo que la página necesita, ya con los nombres de campo
-- que usa el front. El servidor llama a esto una vez y guarda el resultado;
-- no vuelve hasta que le avisen.

CREATE OR REPLACE FUNCTION rc_catalogo() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'version', (SELECT version FROM rc_version WHERE id),
    'categorias', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'key',      c.key,
               'name',     c.nombre,
               'kicker',   c.kicker,
               'note',     c.nota,
               'notaMenu', c.nota_menu,
               'accent',   c.accent,
               'img',      c.img
             ) ORDER BY c.orden, c.key)
      FROM categoria c
    ), '[]'::jsonb),
    'productos', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id',      p.id,
               'name',    p.nombre,
               'set',     p.coleccion,
               'cat',     p.categoria,
               'img',     p.img,
               'price',   p.precio,
               'old',     p.precio_anterior,
               'stock',   p.stock,
               'tag',     p.etiqueta,
               'premium', CASE WHEN p.premium THEN true END
             )) ORDER BY p.nombre)
      FROM producto p
      WHERE p.publicado
    ), '[]'::jsonb),
    'nuevos', COALESCE((
      SELECT jsonb_agg(p.id ORDER BY p.nuevo_orden)
      FROM producto p
      WHERE p.publicado AND p.nuevo_orden IS NOT NULL
    ), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION rc_catalogo() IS
  'Todo el catálogo público en un jsonb, con los nombres de campo que usa la página.';

-- ─────────────────────────────────────────────────────────────────────────
-- Limpieza de sesiones vencidas
-- ─────────────────────────────────────────────────────────────────────────
-- La llama el servidor una vez por hora. No hace falta pg_cron.

CREATE OR REPLACE FUNCTION rc_limpiar_sesiones() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM sesion WHERE expira_en < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Permisos
-- ─────────────────────────────────────────────────────────────────────────
-- La aplicación no es dueña de nada: no puede borrar tablas ni cambiar el
-- esquema. Sobre auditoria sólo inserta (vía trigger) y lee; no puede
-- reescribir el historial.

GRANT CONNECT ON DATABASE rocketcards TO rocketcards_app;
GRANT USAGE ON SCHEMA public TO rocketcards_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON producto, categoria, admin, sesion TO rocketcards_app;
GRANT SELECT, INSERT ON auditoria TO rocketcards_app;
GRANT SELECT, UPDATE ON rc_version TO rocketcards_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rocketcards_app;
GRANT EXECUTE ON FUNCTION rc_catalogo(), rc_limpiar_sesiones() TO rocketcards_app;

-- Para las tablas que se agreguen más adelante.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rocketcards_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO rocketcards_app;

\echo ''
\echo 'Base rocketcards lista.'
\echo ''
\echo 'Falta:'
\echo '  1) ALTER ROLE rocketcards_app PASSWORD ''...'';'
\echo '  2) psql -U postgres -d rocketcards -f db/semilla.sql   (catálogo actual)'
\echo '  3) npm run admin:crear -- <usuario>                    (primer usuario)'
\echo ''
