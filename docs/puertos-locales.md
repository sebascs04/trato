# Puertos locales y aislamiento de Trato

Configuración: [`local-ports.json`](../local-ports.json). Revisada el 26 de octubre de 2026 mediante listeners, directorios de procesos y `docker ps`. No se modificó ningún recurso de QAMAQ.

| Servicio Trato | Puerto del host | Situación |
| --- | --- | --- |
| Interfaz oficial | 5173 | Activo, localhost |
| Interfaz técnica opcional | 5174 | Libre al revisar; sólo con `--tools` |
| API | 8100 | Activo, localhost |
| File processor | 8101 | Activo, localhost |
| Redis propio | 6380 | Activo con `--with-worker`, privado y separado de QAMAQ |
| Weaviate HTTP propio | 8180 | Reservado, no iniciado |
| Weaviate gRPC propio | 51052 | Reservado, no iniciado |

El worker actual consume mensajes; no abre un puerto HTTP. Sus pruebas Redis usan una instancia temporal independiente con puerto efímero, sin conectarse al Redis de QAMAQ. Las reservas anteriores no habilitan esos servicios.

## Arranque

```bash
python3 scripts/dev-polyrepo.py --with-worker
```

El supervisor lee los puertos del JSON, comprueba disponibilidad antes de iniciar hijos y establece explícitamente `PORT`, `TRATO_API_URL` y `FILE_PROCESSOR_URL`. Si no puede reservar un puerto, sale sin iniciar servicios, sin matar al ocupante y sin buscar un puerto alternativo. Una instancia de Trato ya activa también impide iniciar una segunda en los mismos puertos. La comprobación no reemplaza la reserva final del sistema operativo al arrancar cada servicio.

`npm run dev` lee el mismo JSON para web y proxy de API. Los parámetros `--api-port`, `--processor-port`, `PORT` y `TRATO_API_URL` son cambios explícitos de configuración, no mecanismos automáticos para resolver conflictos. Mantener la configuración documentada si se decide modificarlos. Los comandos independientes de los README de cada repositorio usan 8100/8101.

## Recursos ajenos observados: no reutilizar

QAMAQ tiene procesos en 3000 (frontend), 8000 (backend), 8001 (file processor), 8002 (callback) y 8004 (worker). Se confirmó su pertenencia por sus directorios bajo `/home/sebastian/wsl-projects/QAMAQ`. El puerto 6379 también está ocupado; no se investigó su propietario y no se utilizará para Trato.

Contenedores QAMAQ y publicaciones observadas:

| Contenedor | Puertos del host |
| --- | --- |
| qamaq-neo4j | 7474, 7687 |
| qamaq-weaviate-console | 8078 |
| qamaq-weaviate | 8079, 50051 |
| qamaq-dynamodb-local | 8055 |
| qamaq-dynamodb-admin | 8056 |

La disponibilidad cambia: revisar `ss -ltnp` y `docker ps --format '{{.Names}}\t{{.Ports}}'` antes de nuevos arranques. No reiniciar los servicios existentes para liberar un puerto.

## Docker y datos

Trato usa Redis nativo local con esta configuración; no se arrancó un stack Docker. Cuando se añada Compose, usar `name: trato` o `docker compose -p trato`, red propia y volúmenes propios. Publicar sólo en loopback: Redis `127.0.0.1:6380:6379`, Weaviate HTTP `127.0.0.1:8180:8080` y gRPC `127.0.0.1:51052:50051`. Dentro de su red los contenedores pueden usar sus puertos internos habituales; lo que debe ser distinto son los puertos del host y sus recursos.

No usar redes o volúmenes externos de QAMAQ, montar su carpeta ni reutilizar sus servicios, credenciales o datos. No ejecutar `docker system prune`, `docker volume prune` ni comandos globales de parada. Una futura parada del stack se limita al Compose de Trato, sin `-v` salvo autorización explícita para borrar sus datos. Los servicios cloud también deben apuntar a recursos propios de Trato.
