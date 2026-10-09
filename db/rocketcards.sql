-- Rocket Cards — esquema (Supabase)
--
--   Supabase → SQL Editor → pegar entero → Run
--   (o: psql "$DATABASE_URL" -f db/rocketcards.sql)
--
-- Acá no hay comandos de psql, así que anda por los dos caminos.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- Todo el DDL va en UNA transacción y al final hay un solo
-- NOTIFY pgrst, 'reload schema'.
--
-- ── Cómo funciona ───────────────────────────────────────────────────────
-- La tienda y el panel hablan directo con Supabase por supabase-js, con la
-- anon key. No hay servidor propio en el medio. El esquema "rocketcards" se
-- publica por PostgREST, y lo que protege las cosas es RLS, no el secreto de
-- la clave: la anon key es pública por diseño, va dentro de la página.
--
-- Entonces todo depende de que las políticas estén bien. La regla de oro acá
-- es que escribir exige ser el admin de verdad —se verifica contra el email
-- del JWT, del lado del servidor—, no simplemente "estar autenticado".
--
-- ── Por qué no se sobrecarga la base ────────────────────────────────────
-- Nadie pregunta cada tantos segundos. La página lee el catálogo una vez al
-- cargar y después se queda suscrita por Realtime: Supabase le avisa por
-- websocket cuando una fila cambia, y recién ahí vuelve a leer. Mil personas
-- mirando la tienda con el catálogo quieto son cero consultas.
--
-- Para que eso ande, las tablas tienen que estar en la publicación
-- supabase_realtime, que es lo último que hace este script.

BEGIN;

CREATE SCHEMA IF NOT EXISTS rocketcards;

COMMENT ON SCHEMA rocketcards IS
  'Catálogo de Rocket Cards. Se publica por PostgREST; lo protege RLS.';

SET LOCAL search_path TO rocketcards, public;

-- ─────────────────────────────────────────────────────────────────────────
-- Limpieza de la versión anterior
-- ─────────────────────────────────────────────────────────────────────────
-- La primera versión traía un servidor Node propio: login con tabla de
-- usuarios y de sesiones, y un trigger que mandaba NOTIFY para que ese
-- servidor recargara su caché. Ahora el login lo hace Supabase Auth y el
-- aviso lo da Realtime, así que todo eso sobra. Y una tabla con hashes de
-- contraseña en un esquema publicado por PostgREST es justo lo que no
-- conviene tener de más.
--
-- Todo con IF EXISTS: en una base nueva este bloque no hace nada.

-- Primero los triggers viejos. Si quedan, suben la versión dos veces por
-- cambio: una ellos y otra los nuevos.
--
-- CASCADE se lleva los triggers que usaban la función, así no hace falta
-- nombrarlos uno por uno — y de paso esto no se rompe en una base nueva,
-- donde DROP TRIGGER ... ON producto fallaría porque la tabla todavía no
-- existe.
DROP FUNCTION IF EXISTS rocketcards.avisar_cambio() CASCADE;
DROP FUNCTION IF EXISTS rocketcards.limpiar_sesiones() CASCADE;

-- La auditoría vieja referenciaba la tabla admin, y esa clave foránea es la
-- que impide borrarla. Al soltar la columna se va con ella.
ALTER TABLE IF EXISTS rocketcards.auditoria DROP COLUMN IF EXISTS admin_id;
ALTER TABLE IF EXISTS rocketcards.auditoria ADD COLUMN IF NOT EXISTS quien text;

DROP TABLE IF EXISTS rocketcards.sesion;
DROP TABLE IF EXISTS rocketcards.admin;

-- "premium" era un dato muerto: estaba en la tabla y no se mostraba en
-- ningún lado de la tienda. Pasa a llamarse "destacado", que sí se ve.
DO $$
DECLARE
  tiene_premium   boolean;
  tiene_destacado boolean;
BEGIN
  IF to_regclass('rocketcards.producto') IS NULL THEN RETURN; END IF;
  SELECT
    count(*) FILTER (WHERE column_name = 'premium')   > 0,
    count(*) FILTER (WHERE column_name = 'destacado') > 0
  INTO tiene_premium, tiene_destacado
  FROM information_schema.columns
  WHERE table_schema = 'rocketcards' AND table_name = 'producto';

  IF tiene_premium AND NOT tiene_destacado THEN
    ALTER TABLE rocketcards.producto RENAME COLUMN premium TO destacado;
    RAISE NOTICE 'producto.premium pasó a llamarse destacado.';
  ELSIF tiene_premium THEN
    ALTER TABLE rocketcards.producto DROP COLUMN premium;
  END IF;
END
$$;

-- Las políticas viejas dejaban entrar al rol de aquel servidor. No hacen
-- daño, pero una política de más es una cosa más que revisar.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['producto', 'categoria', 'auditoria', 'version']
  LOOP
    IF to_regclass('rocketcards.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS app_total ON rocketcards.%I', t);
    END IF;
  END LOOP;
END
$$;

-- Y el rol de aquel servidor, que ya no se conecta nadie. Si algo todavía
-- depende de él lo dejamos estar: no vale la pena voltear todo el script
-- por un rol de sobra.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'rocketcards_app') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA rocketcards FROM rocketcards_app';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA rocketcards FROM rocketcards_app';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA rocketcards FROM rocketcards_app';
    EXECUTE 'REVOKE ALL ON SCHEMA rocketcards FROM rocketcards_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA rocketcards REVOKE ALL ON TABLES FROM rocketcards_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA rocketcards REVOKE ALL ON SEQUENCES FROM rocketcards_app';
    BEGIN
      EXECUTE 'DROP ROLE rocketcards_app';
      RAISE NOTICE 'Borrado el rol rocketcards_app, que era del servidor viejo.';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'El rol rocketcards_app quedó sin permisos pero no se pudo borrar: %', SQLERRM;
    END;
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Quién es el admin
-- ─────────────────────────────────────────────────────────────────────────
-- Una sola línea para cambiarlo. Lo usan todas las políticas de escritura.
--
-- Verifica el email del JWT, que lo arma el servidor de auth y el navegador
-- no puede falsificar. Con "to authenticated using (true)" alcanzaría con
-- que cualquiera se cree una cuenta para poder escribir; esto no.
--
-- El rodeo por auth.users es porque en Supabase self-hosted el claim 'email'
-- a veces no viene en el token. El 'sub' sí viene siempre, así que si falta
-- el email lo buscamos por id. SECURITY DEFINER porque auth.users no es
-- legible para anon ni authenticated.

CREATE OR REPLACE FUNCTION rocketcards.es_admin() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = rocketcards, public, pg_temp
AS $$
DECLARE
  correo text;
BEGIN
  correo := nullif(auth.jwt() ->> 'email', '');
  IF correo IS NULL AND auth.uid() IS NOT NULL THEN
    SELECT u.email INTO correo FROM auth.users u WHERE u.id = auth.uid();
  END IF;
  RETURN lower(coalesce(correo, '')) = 'admin@rocketcards.com';
END
$$;

REVOKE ALL ON FUNCTION rocketcards.es_admin() FROM public;
GRANT EXECUTE ON FUNCTION rocketcards.es_admin() TO anon, authenticated, service_role;

COMMENT ON FUNCTION rocketcards.es_admin() IS
  'true sólo para admin@rocketcards.com. Cambiar el email acá y nada más.';

-- ─────────────────────────────────────────────────────────────────────────
-- Versión del catálogo
-- ─────────────────────────────────────────────────────────────────────────
-- Una sola fila, sube de a uno con cada cambio. No es imprescindible para
-- que la tienda funcione, pero sirve para ver de un vistazo si dos pantallas
-- están mirando lo mismo, y es lo que muestra el panel arriba a la derecha.
--
-- El CHECK (id) con DEFAULT true es el truco para que la tabla no pueda
-- tener más de una fila: la clave primaria sólo admite el valor true.

CREATE TABLE IF NOT EXISTS version (
  id              boolean     PRIMARY KEY DEFAULT true CHECK (id),
  version         bigint      NOT NULL DEFAULT 1,
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO version (id) VALUES (true) ON CONFLICT DO NOTHING;

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
  destacado       boolean     NOT NULL DEFAULT false,
  imagenes        text[]      NOT NULL DEFAULT '{}',   -- límite de 10: ver abajo
  nuevo_orden     integer,    -- posición en "Nuevos ingresos"; NULL = no sale ahí
  publicado       boolean     NOT NULL DEFAULT true,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);

-- Galería. Para una base que ya tenía la tabla, el CREATE de arriba no hace
-- nada, así que la columna se agrega acá.
ALTER TABLE producto ADD COLUMN IF NOT EXISTS imagenes text[] NOT NULL DEFAULT '{}';
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname = 'producto_imagenes_max') THEN
    ALTER TABLE rocketcards.producto
      ADD CONSTRAINT producto_imagenes_max CHECK (cardinality(imagenes) <= 10);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS producto_categoria_idx
  ON producto (categoria) WHERE publicado;

-- Parcial y único: dos productos no pueden pelearse el mismo lugar del
-- carrusel, y los que no están en "Nuevos ingresos" (NULL) no ocupan índice.
CREATE UNIQUE INDEX IF NOT EXISTS producto_nuevo_orden_idx
  ON producto (nuevo_orden) WHERE nuevo_orden IS NOT NULL;

COMMENT ON COLUMN producto.precio_anterior IS
  'Precio tachado. Si está, se calcula el % de descuento.';
COMMENT ON COLUMN producto.nuevo_orden IS
  'Posición en el carrusel "Nuevos ingresos". NULL = no aparece.';
COMMENT ON COLUMN producto.imagenes IS
  'Todas las fotos, en orden; la primera es la portada y se copia a img.';
COMMENT ON COLUMN producto.destacado IS
  'Lleva etiqueta DESTACADO y va primero en el catálogo.';

-- ─────────────────────────────────────────────────────────────────────────
-- Ajustes de la tienda
-- ─────────────────────────────────────────────────────────────────────────
-- Clave y valor, con la etiqueta y la ayuda guardadas al lado. Así el panel
-- dibuja el formulario leyendo la tabla: agregar un ajuste nuevo es un
-- INSERT acá, sin tocar el panel.

CREATE TABLE IF NOT EXISTS config (
  clave           text        PRIMARY KEY CHECK (clave ~ '^[a-z][a-z0-9_]*$'),
  valor           text        NOT NULL DEFAULT '',
  etiqueta        text        NOT NULL DEFAULT '',
  ayuda           text        NOT NULL DEFAULT '',
  largo           boolean     NOT NULL DEFAULT false,  -- se edita en varias líneas
  orden           integer     NOT NULL DEFAULT 0,
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);

-- El DO UPDATE pisa la etiqueta y la ayuda pero NUNCA el valor: así se puede
-- volver a correr el script sin borrar lo que el comercio ya configuró.
INSERT INTO config (clave, valor, etiqueta, ayuda, largo, orden) VALUES
  ('whatsapp', '595981377541', 'WhatsApp',
   'Sólo números, con código de país y sin espacios. Ej: 595981377541', false, 1),
  ('instagram', 'rocketcardspy', 'Instagram',
   'El usuario, sin la arroba', false, 2),
  ('descripcion', 'Tienda especializada en Pokémon TCG y coleccionismo. Producto sellado original y envíos a todo Paraguay.',
   'Descripción del pie', 'El texto chico que aparece abajo a la izquierda', true, 3)
ON CONFLICT (clave) DO UPDATE
  SET etiqueta = EXCLUDED.etiqueta,
      ayuda    = EXCLUDED.ayuda,
      largo    = EXCLUDED.largo,
      orden    = EXCLUDED.orden;

-- ─────────────────────────────────────────────────────────────────────────
-- Las cartas de la portada
-- ─────────────────────────────────────────────────────────────────────────
-- Cinco lugares fijos, del 1 al 5, en el abanico de la portada. Desde el
-- panel se cambia la foto y su descripción; la inclinación, el tamaño y la
-- profundidad de cada lugar viven en la página.
--
-- Es a propósito: el abanico está calibrado para que las cinco cartas se
-- superpongan bien en cualquier pantalla. Si eso fuera editable, un número
-- mal puesto rompe la portada y no hay forma obvia de volver atrás.

CREATE TABLE IF NOT EXISTS portada (
  orden           integer     PRIMARY KEY CHECK (orden BETWEEN 1 AND 5),
  img             text        NOT NULL DEFAULT '',
  alt             text        NOT NULL DEFAULT '',
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN portada.orden IS
  'Lugar en el abanico, de izquierda a derecha. El 3 es la carta del centro.';
COMMENT ON COLUMN portada.alt IS
  'Qué carta es. Lo leen los lectores de pantalla y los buscadores.';

INSERT INTO portada (orden, img, alt) VALUES
  (1, '/assets/cards/rayquaza-v.webp',  'Rayquaza V · Evolving Skies 194/203'),
  (2, '/assets/cards/leafeon-ex.webp',  'Leafeon ex · Prismatic Evolutions 144/131'),
  (3, '/assets/cards/pikachu-ex.webp',  'Pikachu ex · Teracristal 238/191'),
  (4, '/assets/cards/umbreon-ex.webp',  'Umbreon ex · Prismatic Evolutions 161/131'),
  (5, '/assets/cards/jirachi-ex.webp',  'Jirachi ex · Pikachu 30 155/128')
ON CONFLICT (orden) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- Auditoría
-- ─────────────────────────────────────────────────────────────────────────
-- Quién tocó qué. El autor sale del JWT, no de algo que mande el navegador.

CREATE TABLE IF NOT EXISTS auditoria (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tabla       text        NOT NULL,
  registro_id text        NOT NULL,
  accion      text        NOT NULL CHECK (accion IN ('alta', 'cambio', 'baja')),
  antes       jsonb,
  despues     jsonb,
  quien       text,
  creado_en   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auditoria_creado_idx ON auditoria (creado_en DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- Triggers
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION rocketcards.marcar_fecha() RETURNS trigger
LANGUAGE plpgsql
SET search_path = rocketcards, pg_temp
AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END
$$;

-- Sube la versión una sola vez por transacción, aunque se toquen cien filas.
-- La marca se guarda con set_config(..., true): ese "true" la hace local a
-- la transacción, así que se borra sola al terminar, haya COMMIT o ROLLBACK.
CREATE OR REPLACE FUNCTION rocketcards.subir_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = rocketcards, pg_temp
AS $$
BEGIN
  IF current_setting('rocketcards.contado', true) = txid_current()::text THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('rocketcards.contado', txid_current()::text, true);
  UPDATE version SET version = version + 1, actualizado_en = now() WHERE id;
  RETURN NULL;
END
$$;

-- La auditoría sí es por fila: interesa el detalle de cada uno. El nombre de
-- la columna clave llega como argumento, porque no es el mismo en las dos
-- tablas: producto.id y categoria.key.
CREATE OR REPLACE FUNCTION rocketcards.auditar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = rocketcards, public, pg_temp
AS $$
DECLARE
  clave text  := TG_ARGV[0];
  nuevo jsonb := to_jsonb(NEW);
  viejo jsonb := to_jsonb(OLD);
  autor text  := coalesce(auth.jwt() ->> 'email', auth.uid()::text, 'desconocido');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO auditoria (tabla, registro_id, accion, despues, quien)
    VALUES (TG_TABLE_NAME, nuevo ->> clave, 'alta', nuevo, autor);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Hay que sacar actualizado_en de la comparación: el trigger de fecha ya
    -- lo movió, así que si no lo quitamos las dos filas nunca son iguales y
    -- un UPDATE que no cambió nada entraría igual al historial.
    IF (nuevo - 'actualizado_en') = (viejo - 'actualizado_en') THEN
      RETURN NEW;
    END IF;
    INSERT INTO auditoria (tabla, registro_id, accion, antes, despues, quien)
    VALUES (TG_TABLE_NAME, nuevo ->> clave, 'cambio', viejo, nuevo, autor);
    RETURN NEW;
  ELSE
    INSERT INTO auditoria (tabla, registro_id, accion, antes, quien)
    VALUES (TG_TABLE_NAME, viejo ->> clave, 'baja', viejo, autor);
    RETURN OLD;
  END IF;
END
$$;

-- DROP + CREATE porque CREATE TRIGGER IF NOT EXISTS no existe en Postgres.
-- Al ir todo en la misma transacción, el DROP no deja a la tabla ni un
-- instante sin su trigger para nadie más.

DROP TRIGGER IF EXISTS producto_fecha ON producto;
CREATE TRIGGER producto_fecha BEFORE UPDATE ON producto
  FOR EACH ROW EXECUTE FUNCTION rocketcards.marcar_fecha();

DROP TRIGGER IF EXISTS categoria_fecha ON categoria;
CREATE TRIGGER categoria_fecha BEFORE UPDATE ON categoria
  FOR EACH ROW EXECUTE FUNCTION rocketcards.marcar_fecha();

DROP TRIGGER IF EXISTS config_fecha ON config;
CREATE TRIGGER config_fecha BEFORE UPDATE ON config
  FOR EACH ROW EXECUTE FUNCTION rocketcards.marcar_fecha();

DROP TRIGGER IF EXISTS portada_fecha ON portada;
CREATE TRIGGER portada_fecha BEFORE UPDATE ON portada
  FOR EACH ROW EXECUTE FUNCTION rocketcards.marcar_fecha();

DROP TRIGGER IF EXISTS producto_auditar ON producto;
CREATE TRIGGER producto_auditar AFTER INSERT OR UPDATE OR DELETE ON producto
  FOR EACH ROW EXECUTE FUNCTION rocketcards.auditar('id');

DROP TRIGGER IF EXISTS categoria_auditar ON categoria;
CREATE TRIGGER categoria_auditar AFTER INSERT OR UPDATE OR DELETE ON categoria
  FOR EACH ROW EXECUTE FUNCTION rocketcards.auditar('key');

-- FOR EACH STATEMENT, no FOR EACH ROW: un UPDATE de cien filas entra acá una
-- sola vez, y la marca de transacción se encarga del resto.
DROP TRIGGER IF EXISTS producto_version ON producto;
CREATE TRIGGER producto_version AFTER INSERT OR UPDATE OR DELETE ON producto
  FOR EACH STATEMENT EXECUTE FUNCTION rocketcards.subir_version();

DROP TRIGGER IF EXISTS categoria_version ON categoria;
CREATE TRIGGER categoria_version AFTER INSERT OR UPDATE OR DELETE ON categoria
  FOR EACH STATEMENT EXECUTE FUNCTION rocketcards.subir_version();

DROP TRIGGER IF EXISTS config_version ON config;
CREATE TRIGGER config_version AFTER INSERT OR UPDATE OR DELETE ON config
  FOR EACH STATEMENT EXECUTE FUNCTION rocketcards.subir_version();

DROP TRIGGER IF EXISTS portada_version ON portada;
CREATE TRIGGER portada_version AFTER INSERT OR UPDATE OR DELETE ON portada
  FOR EACH STATEMENT EXECUTE FUNCTION rocketcards.subir_version();

DROP TRIGGER IF EXISTS config_auditar ON config;
CREATE TRIGGER config_auditar AFTER INSERT OR UPDATE OR DELETE ON config
  FOR EACH ROW EXECUTE FUNCTION rocketcards.auditar('clave');

DROP TRIGGER IF EXISTS portada_auditar ON portada;
CREATE TRIGGER portada_auditar AFTER INSERT OR UPDATE OR DELETE ON portada
  FOR EACH ROW EXECUTE FUNCTION rocketcards.auditar('orden');

-- ─────────────────────────────────────────────────────────────────────────
-- El catálogo, en una sola llamada
-- ─────────────────────────────────────────────────────────────────────────
-- La tienda pide esto y ya: un viaje en vez de tres, y con los nombres de
-- campo que usa la página, así no hay que traducir nada del lado del
-- navegador.
--
-- SECURITY INVOKER a propósito (es el default): corre con los permisos de
-- quien llama, así que RLS sigue aplicando y el público sólo ve los
-- productos publicados.

CREATE OR REPLACE FUNCTION rocketcards.catalogo() RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = rocketcards, pg_temp
AS $$
  SELECT jsonb_build_object(
    'version', (SELECT version FROM version WHERE id),
    'categorias', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'key', c.key, 'name', c.nombre, 'kicker', c.kicker,
               'note', c.nota, 'notaMenu', c.nota_menu,
               'accent', c.accent, 'img', c.img
             ) ORDER BY c.orden, c.key)
      FROM categoria c
    ), '[]'::jsonb),
    'productos', COALESCE((
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', p.id, 'name', p.nombre, 'set', p.coleccion,
               'cat', p.categoria, 'img', p.img, 'price', p.precio,
               'old', p.precio_anterior, 'stock', p.stock, 'tag', p.etiqueta,
               'destacado', CASE WHEN p.destacado THEN true END,
               'imagenes', CASE WHEN cardinality(p.imagenes) > 0 THEN to_jsonb(p.imagenes) END
             )) ORDER BY p.destacado DESC, p.nombre)
      FROM producto p
      WHERE p.publicado
    ), '[]'::jsonb),
    'config', COALESCE((
      SELECT jsonb_object_agg(c.clave, c.valor) FROM config c
    ), '{}'::jsonb),
    'portada', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('img', t.img, 'alt', t.alt) ORDER BY t.orden)
      FROM portada t
    ), '[]'::jsonb),
    'nuevos', COALESCE((
      SELECT jsonb_agg(p.id ORDER BY p.nuevo_orden)
      FROM producto p
      WHERE p.publicado AND p.nuevo_orden IS NOT NULL
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION rocketcards.catalogo() TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- Reordenar "Nuevos ingresos" de una sola vez
-- ─────────────────────────────────────────────────────────────────────────
-- Por PostgREST cada llamada es su propia transacción, así que el panel no
-- puede hacer "borro el orden y después lo escribo" sin que el carrusel
-- quede vacío en el medio para quien esté mirando la tienda. Además el
-- índice único no deja que dos productos compartan posición ni un instante.
--
-- Por eso va como función: adentro es una sola transacción, y Realtime manda
-- un solo aviso en vez de dos.

CREATE OR REPLACE FUNCTION rocketcards.guardar_nuevos(ids text[])
RETURNS SETOF text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = rocketcards, public, pg_temp
AS $$
DECLARE
  tocados integer;
BEGIN
  IF NOT rocketcards.es_admin() THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF array_length(ids, 1) > 12 THEN
    RAISE EXCEPTION 'El carrusel no lleva más de 12 productos';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(ids) x) <> coalesce(array_length(ids, 1), 0) THEN
    RAISE EXCEPTION 'Hay productos repetidos en la lista';
  END IF;

  UPDATE producto SET nuevo_orden = NULL WHERE nuevo_orden IS NOT NULL;

  IF coalesce(array_length(ids, 1), 0) > 0 THEN
    UPDATE producto p SET nuevo_orden = n.orden
      FROM unnest(ids) WITH ORDINALITY AS n(id, orden)
     WHERE p.id = n.id;
    GET DIAGNOSTICS tocados = ROW_COUNT;
    IF tocados <> array_length(ids, 1) THEN
      RAISE EXCEPTION 'Alguno de esos productos no existe';
    END IF;
  END IF;

  RETURN QUERY SELECT p.id FROM producto p WHERE p.nuevo_orden IS NOT NULL ORDER BY p.nuevo_orden;
END
$$;

REVOKE ALL ON FUNCTION rocketcards.guardar_nuevos(text[]) FROM public;
GRANT EXECUTE ON FUNCTION rocketcards.guardar_nuevos(text[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- Permisos
-- ─────────────────────────────────────────────────────────────────────────
-- Los GRANT abren la puerta; RLS decide quién pasa. Hacen falta los dos.

GRANT USAGE ON SCHEMA rocketcards TO anon, authenticated, service_role;

GRANT SELECT ON producto, categoria, version, config, portada TO anon, authenticated;
GRANT SELECT ON auditoria TO authenticated;
GRANT INSERT, UPDATE, DELETE ON producto, categoria, config, portada TO authenticated;
GRANT INSERT ON auditoria TO authenticated;
GRANT UPDATE ON version TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA rocketcards TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA rocketcards TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────
-- Lo único que separa el catálogo de internet. La anon key está escrita en
-- la página, así que cualquiera puede hablarle a PostgREST con ella.
--
-- Escribir exige es_admin(), no "estar autenticado": en una instancia con
-- registro abierto, cualquiera se crea una cuenta en diez segundos y ya
-- sería "authenticated".

ALTER TABLE producto  ENABLE ROW LEVEL SECURITY;
ALTER TABLE categoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE version   ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE portada   ENABLE ROW LEVEL SECURITY;

-- Productos: el público ve los publicados; el admin ve todos.
DROP POLICY IF EXISTS producto_lectura ON producto;
CREATE POLICY producto_lectura ON producto
  FOR SELECT USING (publicado OR rocketcards.es_admin());

DROP POLICY IF EXISTS producto_escritura ON producto;
CREATE POLICY producto_escritura ON producto
  FOR ALL TO authenticated
  USING (rocketcards.es_admin()) WITH CHECK (rocketcards.es_admin());

-- Categorías: lectura pública, escritura sólo del admin.
DROP POLICY IF EXISTS categoria_lectura ON categoria;
CREATE POLICY categoria_lectura ON categoria FOR SELECT USING (true);

DROP POLICY IF EXISTS categoria_escritura ON categoria;
CREATE POLICY categoria_escritura ON categoria
  FOR ALL TO authenticated
  USING (rocketcards.es_admin()) WITH CHECK (rocketcards.es_admin());

-- Ajustes y portada: los lee cualquiera (la tienda los necesita para
-- dibujarse), los escribe sólo el admin.
DROP POLICY IF EXISTS config_lectura ON config;
CREATE POLICY config_lectura ON config FOR SELECT USING (true);

DROP POLICY IF EXISTS config_escritura ON config;
CREATE POLICY config_escritura ON config
  FOR ALL TO authenticated
  USING (rocketcards.es_admin()) WITH CHECK (rocketcards.es_admin());

DROP POLICY IF EXISTS portada_lectura ON portada;
CREATE POLICY portada_lectura ON portada FOR SELECT USING (true);

DROP POLICY IF EXISTS portada_escritura ON portada;
CREATE POLICY portada_escritura ON portada
  FOR ALL TO authenticated
  USING (rocketcards.es_admin()) WITH CHECK (rocketcards.es_admin());

-- Versión: la lee cualquiera; la sube el trigger, que es SECURITY DEFINER.
DROP POLICY IF EXISTS version_lectura ON version;
CREATE POLICY version_lectura ON version FOR SELECT USING (true);

-- Auditoría: sólo el admin la ve. Las filas las pone el trigger.
DROP POLICY IF EXISTS auditoria_lectura ON auditoria;
CREATE POLICY auditoria_lectura ON auditoria
  FOR SELECT TO authenticated USING (rocketcards.es_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- Fotos de producto
-- ─────────────────────────────────────────────────────────────────────────
-- Un bucket para subir las fotos desde el panel, en vez de tener que meterlas
-- al repo y volver a publicar el sitio.
--
-- Público de lectura: son fotos de productos en una tienda, las tiene que
-- poder ver cualquiera sin pedir permiso. Subir, reemplazar y borrar, sólo el
-- admin — las mismas reglas que el catálogo.
--
-- El límite de tamaño y la lista de tipos son del lado del servidor: el panel
-- también valida, pero esa validación vive en el navegador y no cuenta.
--
-- Va envuelto en un IF porque el esquema storage es de Supabase: en un
-- Postgres pelado este bloque no hace nada y el resto del script sirve igual.

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE NOTICE 'Sin esquema storage: me salteo el bucket de fotos.';
    RETURN;
  END IF;

  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('rocketcards', 'rocketcards', true, 5242880,
          ARRAY['image/webp', 'image/png', 'image/jpeg', 'image/avif'])
  ON CONFLICT (id) DO UPDATE
    SET public = true,
        file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

  DROP POLICY IF EXISTS "rocketcards fotos lectura" ON storage.objects;
  CREATE POLICY "rocketcards fotos lectura" ON storage.objects
    FOR SELECT USING (bucket_id = 'rocketcards');

  DROP POLICY IF EXISTS "rocketcards fotos subir" ON storage.objects;
  CREATE POLICY "rocketcards fotos subir" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'rocketcards' AND rocketcards.es_admin());

  DROP POLICY IF EXISTS "rocketcards fotos reemplazar" ON storage.objects;
  CREATE POLICY "rocketcards fotos reemplazar" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'rocketcards' AND rocketcards.es_admin())
    WITH CHECK (bucket_id = 'rocketcards' AND rocketcards.es_admin());

  DROP POLICY IF EXISTS "rocketcards fotos borrar" ON storage.objects;
  CREATE POLICY "rocketcards fotos borrar" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'rocketcards' AND rocketcards.es_admin());
END
$$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- Realtime
-- ─────────────────────────────────────────────────────────────────────────
-- Esto es lo que reemplaza al "avisame cuando cambie": Supabase empuja los
-- cambios de estas tablas por websocket a quien esté suscrito, y la página
-- vuelve a leer el catálogo sólo en ese momento.
--
-- Fuera de la transacción porque ALTER PUBLICATION falla si la tabla ya está
-- y no queremos que eso tire abajo todo lo demás.

DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'No existe la publicación supabase_realtime: Realtime no está habilitado en esta instancia.';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['producto', 'categoria', 'version', 'config', 'portada']
  LOOP
    IF NOT EXISTS (
      SELECT FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'rocketcards' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE rocketcards.%I', t);
      RAISE NOTICE 'Realtime: agregada rocketcards.%', t;
    END IF;
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Avisar a PostgREST
-- ─────────────────────────────────────────────────────────────────────────
-- Guarda el esquema en caché: si no se lo decimos, no ve las tablas nuevas.
-- Una sola vez y después del COMMIT.

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE 'Esquema rocketcards listo.';
  RAISE NOTICE 'Falta:';
  RAISE NOTICE '  1) agregar "rocketcards" a Settings -> API -> Exposed schemas';
  RAISE NOTICE '  2) correr db/semilla.sql';
  RAISE NOTICE '  3) crear el usuario admin@rocketcards.com en Authentication';
END
$$;
