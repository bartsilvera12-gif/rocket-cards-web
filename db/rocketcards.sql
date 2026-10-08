-- Rocket Cards — esquema (Supabase / Postgres)
--
--   psql "$DATABASE_URL" -f db/rocketcards.sql
--
-- Por psql, no pegado en el editor SQL del panel de Supabase: es un cambio
-- grande, y el editor web corre cada bloque por su cuenta.
--
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- Todo el DDL va en UNA transacción y al final hay un solo
-- NOTIFY pgrst, 'reload schema'.
--
-- ── Por qué un esquema propio ───────────────────────────────────────────
-- Nada de esto vive en "public". PostgREST publica "public" por defecto, así
-- que cualquier tabla que pongamos ahí queda al alcance de la clave anónima
-- del proyecto. Acá hay hashes de contraseña y identificadores de sesión: en
-- "public" serían legibles desde internet aunque nosotros nunca usemos la API
-- REST.
--
-- Con el esquema "rocketcards" —que no está en la lista de esquemas expuestos
-- de PostgREST— no hace falta RLS para que estas tablas sean inalcanzables
-- por la API: PostgREST directamente no las ve. Nuestro servidor entra por
-- conexión directa, que no pasa por ahí.
--
-- Si alguna vez querés leer "producto" desde supabase-js, no agregues este
-- esquema a la lista de expuestos: hacé una vista en "public" con los campos
-- públicos y ponele RLS.
--
-- ── Por qué no se sobrecarga la base ────────────────────────────────────
-- La tienda no consulta la base. El servidor lee el catálogo una vez con
-- rocketcards.catalogo(), lo guarda en memoria, y sólo vuelve a leer cuando
-- Postgres le avisa por el canal 'rocketcards' (LISTEN/NOTIFY). Mil visitas
-- con el catálogo quieto son cero consultas.
--
-- OJO con la cadena de conexión: el pooler de Supabase en modo transacción
-- (puerto 6543) NO soporta LISTEN/NOTIFY. Hay que usar la conexión directa o
-- el pooler en modo sesión (5432). Ver ADMIN.md.

BEGIN;

CREATE SCHEMA IF NOT EXISTS rocketcards;

COMMENT ON SCHEMA rocketcards IS
  'Datos de la tienda. Fuera de public a propósito: PostgREST no lo publica.';

SET LOCAL search_path TO rocketcards, public;

-- ─────────────────────────────────────────────────────────────────────────
-- Rol de la aplicación
-- ─────────────────────────────────────────────────────────────────────────
-- Nace SIN contraseña, así no puede conectarse hasta que le pongas una. Es a
-- propósito: un rol con la contraseña escrita en un archivo del repo es un
-- rol público. Al terminar este script:
--
--   ALTER ROLE rocketcards_app PASSWORD 'la-que-elijas';
--
-- En Supabase el usuario de la cadena de conexión no es "rocketcards_app" a
-- secas: por el pooler va "rocketcards_app.<ref-del-proyecto>". Ver ADMIN.md.

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
-- Una sola fila. Sube de a uno cada vez que cambia algo que la tienda
-- muestra. El servidor la usa como ETag: si el navegador ya tiene esa
-- versión, le responde 304 sin mirar la base ni mandar el catálogo de nuevo.
--
-- El CHECK (id) con DEFAULT true es el truco para que la tabla no pueda tener
-- más de una fila: la clave primaria sólo admite el valor true.

CREATE TABLE IF NOT EXISTS version (
  id              boolean     PRIMARY KEY DEFAULT true CHECK (id),
  version         bigint      NOT NULL DEFAULT 1,
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO version (id) VALUES (true) ON CONFLICT DO NOTHING;

COMMENT ON TABLE version IS
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
-- El hash lo calcula el servidor con scrypt (nativo de Node, sin
-- dependencias) y se guarda como "scrypt$N$r$p$salt$hash". Acá nunca entra
-- una contraseña en claro.
--
-- Estas dos tablas son la razón principal por la que nada de esto vive en
-- "public": ver el comentario del encabezado.

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
-- set_config('rocketcards.admin', ...) antes de escribir; si no lo declara,
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
--
-- Nada que ver con el NOTIFY a 'pgrst' del final: ese avisa que cambió la
-- FORMA de la base y lo escucha PostgREST. Éste avisa que cambió el
-- CONTENIDO del catálogo y lo escucha nuestro servidor.

CREATE OR REPLACE FUNCTION rocketcards.avisar_cambio() RETURNS trigger
LANGUAGE plpgsql
SET search_path = rocketcards, pg_temp
AS $$
DECLARE
  v bigint;
BEGIN
  IF current_setting('rocketcards.avisado', true) = txid_current()::text THEN
    RETURN NULL;                      -- ya avisamos en esta transacción
  END IF;
  PERFORM set_config('rocketcards.avisado', txid_current()::text, true);

  UPDATE version
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

COMMENT ON FUNCTION rocketcards.avisar_cambio() IS
  'Sube version y manda un NOTIFY por el canal rocketcards. Una vez por transacción.';

CREATE OR REPLACE FUNCTION rocketcards.marcar_fecha() RETURNS trigger
LANGUAGE plpgsql
SET search_path = rocketcards, pg_temp
AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END
$$;

-- La auditoría sí es por fila: interesa el detalle de cada uno. El nombre de
-- la columna clave llega como argumento del trigger, porque no es el mismo en
-- las dos tablas: producto.id y categoria.key.
CREATE OR REPLACE FUNCTION rocketcards.auditar() RETURNS trigger
LANGUAGE plpgsql
SET search_path = rocketcards, pg_temp
AS $$
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
    -- Un UPDATE que no cambió nada no es noticia. Hay que sacar
    -- actualizado_en de la comparación: el trigger de fecha ya lo movió, así
    -- que si no lo quitamos las dos filas nunca son iguales.
    IF (nuevo - 'actualizado_en') = (viejo - 'actualizado_en') THEN
      RETURN NEW;
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

-- DROP + CREATE porque CREATE TRIGGER IF NOT EXISTS no existe en Postgres.
-- Al ir todo en la misma transacción, el DROP no deja a la tabla ni un
-- instante sin su trigger para nadie más.

DROP TRIGGER IF EXISTS producto_fecha ON producto;
CREATE TRIGGER producto_fecha
  BEFORE UPDATE ON producto
  FOR EACH ROW EXECUTE FUNCTION rocketcards.marcar_fecha();

DROP TRIGGER IF EXISTS categoria_fecha ON categoria;
CREATE TRIGGER categoria_fecha
  BEFORE UPDATE ON categoria
  FOR EACH ROW EXECUTE FUNCTION rocketcards.marcar_fecha();

DROP TRIGGER IF EXISTS producto_auditar ON producto;
CREATE TRIGGER producto_auditar
  AFTER INSERT OR UPDATE OR DELETE ON producto
  FOR EACH ROW EXECUTE FUNCTION rocketcards.auditar('id');

DROP TRIGGER IF EXISTS categoria_auditar ON categoria;
CREATE TRIGGER categoria_auditar
  AFTER INSERT OR UPDATE OR DELETE ON categoria
  FOR EACH ROW EXECUTE FUNCTION rocketcards.auditar('key');

-- FOR EACH STATEMENT, no FOR EACH ROW: un UPDATE de cien filas entra acá una
-- sola vez, y la marca de transacción se encarga del resto.
DROP TRIGGER IF EXISTS producto_avisar ON producto;
CREATE TRIGGER producto_avisar
  AFTER INSERT OR UPDATE OR DELETE ON producto
  FOR EACH STATEMENT EXECUTE FUNCTION rocketcards.avisar_cambio();

DROP TRIGGER IF EXISTS categoria_avisar ON categoria;
CREATE TRIGGER categoria_avisar
  AFTER INSERT OR UPDATE OR DELETE ON categoria
  FOR EACH STATEMENT EXECUTE FUNCTION rocketcards.avisar_cambio();

-- ─────────────────────────────────────────────────────────────────────────
-- El catálogo, en una sola consulta
-- ─────────────────────────────────────────────────────────────────────────
-- Devuelve exactamente lo que la página necesita, ya con los nombres de campo
-- que usa el front. El servidor llama a esto una vez y guarda el resultado;
-- no vuelve hasta que le avisen.

CREATE OR REPLACE FUNCTION rocketcards.catalogo() RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = rocketcards, pg_temp
AS $$
  SELECT jsonb_build_object(
    'version', (SELECT version FROM version WHERE id),
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

COMMENT ON FUNCTION rocketcards.catalogo() IS
  'Todo el catálogo público en un jsonb, con los nombres de campo que usa la página.';

-- ─────────────────────────────────────────────────────────────────────────
-- Limpieza de sesiones vencidas
-- ─────────────────────────────────────────────────────────────────────────
-- La llama el servidor una vez por hora. No hace falta pg_cron.

CREATE OR REPLACE FUNCTION rocketcards.limpiar_sesiones() RETURNS integer
LANGUAGE plpgsql
SET search_path = rocketcards, pg_temp
AS $$
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

GRANT USAGE ON SCHEMA rocketcards TO rocketcards_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON producto, categoria, admin, sesion TO rocketcards_app;
GRANT SELECT, INSERT ON auditoria TO rocketcards_app;
GRANT SELECT, UPDATE ON version TO rocketcards_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA rocketcards TO rocketcards_app;
GRANT EXECUTE ON FUNCTION rocketcards.catalogo(), rocketcards.limpiar_sesiones()
  TO rocketcards_app;

-- Para las tablas que se agreguen más adelante.
ALTER DEFAULT PRIVILEGES IN SCHEMA rocketcards
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rocketcards_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA rocketcards
  GRANT USAGE, SELECT ON SEQUENCES TO rocketcards_app;

-- Cinturón y tiradores. El esquema no está expuesto por PostgREST, así que
-- anon y authenticated no deberían poder llegar igual; esto lo deja escrito
-- por si alguien agrega "rocketcards" a la lista de esquemas expuestos sin
-- leer el encabezado de este archivo.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA rocketcards FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA rocketcards FROM anon;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rocketcards FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA rocketcards FROM authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA rocketcards FROM authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rocketcards FROM authenticated;
  END IF;
END
$$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Avisar a PostgREST
-- ─────────────────────────────────────────────────────────────────────────
-- PostgREST guarda el esquema en caché: si no se lo decimos, no ve los
-- cambios. Va una sola vez y después del COMMIT, no una por cada DDL: antes
-- del commit los cambios todavía no existen para nadie más, y repetirlo por
-- cada CREATE lo obliga a releer el catálogo entero una vez por línea.

NOTIFY pgrst, 'reload schema';

\echo ''
\echo 'Esquema rocketcards listo.'
\echo ''
\echo 'Falta:'
\echo '  1) ALTER ROLE rocketcards_app PASSWORD ''...'';'
\echo '  2) psql "$DATABASE_URL" -f db/semilla.sql   (catálogo actual)'
\echo '  3) npm run admin:crear -- <usuario> --dueno'
\echo ''
