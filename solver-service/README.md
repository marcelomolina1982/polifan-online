# Motor CNC externo

Este servicio ejecuta PackingSolver C++ fuera de Vercel.

## Render
1. Crear un nuevo Web Service desde este repositorio.
2. Root Directory: `solver-service`
3. Environment: Docker.
4. Deploy.
5. Copiar la URL pública, por ejemplo `https://polifan-cnc-solver.onrender.com`.

En el proyecto Vercel del frontend agregar:

`VITE_NEST_API_URL=https://polifan-cnc-solver.onrender.com`

Luego hacer Redeploy.

Endpoints:
- `GET /health`
- `POST /nest`
