# Trato Web

Cliente estático de integración para comprobar PDF/DOCX a través de Trato API. La interfaz de producto existente sigue en la raíz del proyecto original; aún no se ha migrado a este repositorio para no interferir con P1.

**La interfaz oficial elegida por Sebastian es la raíz en localhost:5173.** Este directorio conserva únicamente la herramienta técnica de 5174. La autenticación/persistencia se integraron en el perfil y Clientes del diseño original mediante connected-workspace.mjs; no sustituir ese diseño por esta herramienta.

```bash
npm run dev
```

Abre http://localhost:5174 solo para pruebas técnicas. No requiere paquetes npm. Configura API `http://localhost:8100`; el acceso por correo/contraseña usa Supabase Auth. Tokens mínimos se guardan en sessionStorage para recargar, no contraseñas ni service role. Los tokens no se envían al procesador privado.

Permite clientes/proyectos e ingesta persistente de PDF/DOCX y sus fragmentos. El servidor solo sirve archivos explícitamente permitidos de `public/`. No hay análisis con IA ni aceptación automática de documentos.

```bash
npm run check
```

Para producción, publicar únicamente `public/` como sitio estático y configurar el origen autorizado en Trato API. El servidor Node local no es un proxy de pagos ni procesa documentos.
