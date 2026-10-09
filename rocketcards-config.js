// Configuración de Supabase.
//
// La anon key es pública por diseño: va dentro de la página, cualquiera que
// abra el sitio la puede leer. Lo que protege los datos no es que esta clave
// sea secreta, es RLS (ver db/rocketcards.sql). NO poner acá la service_role.
//
// Cambiar adminEmail acá no alcanza: el que manda es es_admin() en el SQL.
// Acá sólo sirve para no mostrarle el panel a quien no corresponde.

window.ROCKET_CONFIG = {
  url: 'https://api.neura.com.py',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzc0MTAxNDYxLCJleHAiOjE5MzE3ODE0NjF9.7_wAph8IolPMXtgfpezSwS5XR62IdD__qhqCywLDp3Q',
  schema: 'rocketcards',
  bucket: 'rocketcards',   // fotos de producto subidas desde el panel
  adminEmail: 'admin@rocketcards.com',
};
