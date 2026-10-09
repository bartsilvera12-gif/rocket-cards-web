-- Rocket Cards — catálogo inicial
--
--   psql "$DATABASE_URL" -f db/semilla.sql
--
-- Generado por scripts/exportar-semilla.mjs a partir de los arreglos
-- CATEGORIAS, CATALOG y NEW_IDS de la página. No editar a mano: una vez que
-- la base es la fuente de verdad, los cambios van por el panel de admin.
--
-- Todo en una transacción, así los triggers mandan UN solo NOTIFY para la
-- carga entera en vez de uno por producto.

BEGIN;

SET LOCAL search_path TO rocketcards;

INSERT INTO categoria (key, nombre, kicker, nota, nota_menu, accent, img, orden) VALUES
  ('sellados', 'Sellados y coleccionables', 'Producto sellado', 'Bundle · Collections · Premium', 'Booster Box · Bundle · Collections', '#E30613', '/assets/catalogo/prismatic-figure-collection.webp', 1),
  ('sobres', 'Sobres', 'Booster packs', 'Sellados de origen', 'Sellados de origen', '#F5F5F5', '/assets/catalogo/pitch-black-pack.webp', 2),
  ('etb', 'ETB', 'Elite Trainer Box', 'Set completo + accesorios', 'Elite Trainer Box', '#C9A227', '/assets/catalogo/koraidon-etb.webp', 3),
  ('singles', 'Singles', 'Carta suelta', 'Cartas individuales', 'Cartas individuales', '#FF1A27', '/assets/cards/pikachu-ex.webp', 4)
ON CONFLICT (key) DO UPDATE SET
  nombre = EXCLUDED.nombre, kicker = EXCLUDED.kicker, nota = EXCLUDED.nota,
  nota_menu = EXCLUDED.nota_menu, accent = EXCLUDED.accent, img = EXCLUDED.img,
  orden = EXCLUDED.orden;

INSERT INTO producto (id, nombre, coleccion, categoria, img, precio, precio_anterior, stock, etiqueta, premium, nuevo_orden) VALUES
  ('FP-S1', 'First Partner Illustration Collection — Series 1', 'Pokémon TCG · Illustration Collection', 'sellados', '/assets/catalogo/first-partner-s1.webp', 420000, NULL, 5, 'NUEVO', false, 6),
  ('FP-S2', 'First Partner Illustration Collection — Series 2', 'Pokémon TCG · Illustration Collection', 'sellados', '/assets/catalogo/first-partner-s2.webp', 300000, NULL, 6, 'NUEVO', false, 1),
  ('FP-S3', 'First Partner Illustration Collection — Series 3', 'Pokémon TCG · Illustration Collection', 'sellados', '/assets/catalogo/first-partner-s3.webp', 300000, NULL, 6, 'NUEVO', false, NULL),
  ('KO-COL', 'Knock Out Collection', 'Pokémon TCG · Collection', 'sellados', '/assets/catalogo/knock-out-collection.webp', 300000, NULL, 4, NULL, false, NULL),
  ('ME-CR-BB', 'Mega Evolution — Chaos Rising Booster Bundle', 'Mega Evolution · 6 sobres', 'sellados', '/assets/catalogo/chaos-rising-bundle.webp', 350000, NULL, 7, NULL, false, NULL),
  ('ME-CR-PK', 'Mega Evolution — Chaos Rising Booster Pack', 'Mega Evolution · 1 sobre', 'sobres', '/assets/catalogo/chaos-rising-pack.webp', 60000, NULL, 36, NULL, false, NULL),
  ('ME-PO-PK', 'Mega Evolution — Perfect Order Booster Pack', 'Mega Evolution · 1 sobre', 'sobres', '/assets/catalogo/perfect-order-pack.webp', 60000, NULL, 42, NULL, false, NULL),
  ('ME-PB-ETB', 'Mega Evolution — Pitch Black Elite Trainer Box', 'Mega Evolution · ETB', 'etb', '/assets/catalogo/pitch-black-etb.webp', 650000, NULL, 3, 'NUEVO', false, 2),
  ('ME-PB-BB', 'Mega Evolution — Pitch Black Booster Bundle', 'Mega Evolution · 6 sobres', 'sellados', '/assets/catalogo/pitch-black-bundle.webp', 350000, NULL, 8, NULL, false, NULL),
  ('ME-PB-PK', 'Mega Evolution — Pitch Black Booster Pack', 'Mega Evolution · 1 sobre', 'sobres', '/assets/catalogo/pitch-black-pack.webp', 65000, NULL, 30, NULL, false, NULL),
  ('ME-AH-TS', 'Mega Evolution — Ascended Heroes Tech Sticker Collection', 'Mega Evolution · Collection', 'sellados', '/assets/catalogo/ascended-heroes-sticker.webp', 310000, NULL, 6, NULL, false, 4),
  ('ME-PF-ETB', 'Mega Evolution — Phantasmal Flames Elite Trainer Box', 'Mega Evolution · ETB', 'etb', '/assets/catalogo/phantasmal-flames-etb.webp', 1200000, NULL, 2, NULL, false, NULL),
  ('SV-BB-ETB', 'Scarlet & Violet — Black Bolt Elite Trainer Box', 'Scarlet & Violet · ETB', 'etb', '/assets/catalogo/black-bolt-etb.webp', 1400000, NULL, 2, NULL, false, NULL),
  ('SV-DR-BB', 'Scarlet & Violet — Destined Rivals Booster Bundle', 'Scarlet & Violet · 6 sobres', 'sellados', '/assets/catalogo/destined-rivals-bundle.webp', 600000, NULL, 0, 'AGOTADO', false, NULL),
  ('SV-KO-ETB', 'Scarlet & Violet — Koraidon Elite Trainer Box', 'Scarlet & Violet · ETB', 'etb', '/assets/catalogo/koraidon-etb.webp', 1500000, NULL, 1, NULL, false, NULL),
  ('SV-DR-ETB', 'Scarlet & Violet — Destined Rivals Elite Trainer Box', 'Scarlet & Violet · ETB', 'etb', '/assets/catalogo/destined-rivals-etb.webp', 1100000, NULL, 3, NULL, false, NULL),
  ('SV-PE-PFC', 'Scarlet & Violet — Prismatic Evolutions Premium Figure Collection', 'Prismatic Evolutions · Premium', 'sellados', '/assets/catalogo/prismatic-figure-collection.webp', 1500000, NULL, 1, NULL, true, 3),
  ('SV-PE-BB', 'Prismatic Evolutions — Booster Bundle (ING)', 'Prismatic Evolutions · 6 sobres', 'sellados', '/assets/catalogo/prismatic-bundle.webp', 600000, NULL, 4, NULL, false, 5)
ON CONFLICT (id) DO UPDATE SET
  nombre = EXCLUDED.nombre, coleccion = EXCLUDED.coleccion, categoria = EXCLUDED.categoria,
  img = EXCLUDED.img, precio = EXCLUDED.precio, precio_anterior = EXCLUDED.precio_anterior,
  stock = EXCLUDED.stock, etiqueta = EXCLUDED.etiqueta, premium = EXCLUDED.premium,
  nuevo_orden = EXCLUDED.nuevo_orden;

COMMIT;

DO $$ BEGIN RAISE NOTICE '4 categorias y 18 productos cargados.'; END $$;
