# V2 performance guardrails

- Cache local = arranque visual, nunca fuente de verdad.
- Cada módulo se revalida contra Supabase al entrar por primera vez en la sesión.
- No guardar en localStorage bloques pesados: catálogo con imágenes, SVG, fotos/reseñas y placas generadas.
- Escrituras: refrescar sólo secciones modificadas y fusionar por id cuando son colecciones.
- Motor: conservar job remoto y evitar polling excesivo.
- Producción/main no se modifica durante preparación V2.
