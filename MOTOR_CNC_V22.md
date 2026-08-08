# Motor CNC v22

Arquitectura:
- Frontend Vite/React en Vercel.
- Motor industrial PackingSolver C++ en servicio Docker externo.
- Comunicación por `VITE_NEST_API_URL`.

Motivo:
Vercel usa una plataforma manylinux_2_34 para su runtime Python actual. El wheel Linux de pyckingsolver 0.1.15 requiere manylinux_2_35, por lo que no puede instalarse allí.

El contenedor usa Debian Bookworm, cuya glibc satisface el wheel manylinux_2_35.
