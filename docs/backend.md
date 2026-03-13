# Documentación Técnica - Invitapop (Backend)


Esta documentación describe la arquitectura, configuración y funcionamiento del backend de Invitapop, un sistema de gestión de invitaciones digitales y eventos con confirmación RSVP.

## 1. Resumen del proyecto
- **Qué es Invitapop**: Plataforma para crear, personalizar y enviar invitaciones digitales interactivas para eventos.
- **Objetivo del sistema**: Facilitar la gestión de invitados, el control de asistencia (RSVP) y la personalización de diseños para eventos de cualquier escala.
- **Stack tecnológico real**:
  - **Lenguaje**: Node.js (JavaScript)
  - **Framework API**: Express.js
  - **Base de Datos y Auth**: Supabase (PostgreSQL / GoTrue)
  - **Pagos**: Stripe
  - **Correos**: Resend
  - **Procesamiento de Imágenes**: Sharp / Multer
  - **Entorno**: Docker / Docker Compose

## 2. Arquitectura General
El backend actúa como una capa de orquestación entre el cliente (Frontend) y los servicios de infraestructura (Supabase, Stripe, Resend).

- **Frontend**: Consume la API de Node.js para operaciones complejas y lógica de negocio.
- **Backend**: API RESTful basada en Express.
- **Base de datos / Auth / Storage**: Delegado a Supabase. El backend utiliza `supabase-js` con el `service_role_key` para bypass de RLS cuando es necesario.
- **Flujo General**:
  1. El Cliente envía una solicitud a la API.
  2. La API valida la sesión mediante cookies (JWT).
  3. El Backend interactúa con Supabase para persistencia o con servicios externos (Stripe/Resend).
  4. Retorna una respuesta JSON al Cliente.

## 3. Configuración del entorno
Variables requeridas en el archivo `.env`:

| Variable | Descripción | Obligatorio |
| :--- | :--- | :--- |
| `PORT` | Puerto de escucha (defecto: 4000) | No |
| `FRONTEND_ORIGINS` | URLs permitidas para CORS (separadas por coma) | Sí |
| `FRONTEND_PUBLIC_URL` | URL pública del frontend (para links de reset) | Sí |
| `SUPABASE_URL` | URL de tu proyecto Supabase | Sí |
| `SUPABASE_ANON_KEY` | Clave anónima pública de Supabase | Sí |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave secreta administrativa (Uso servidor) | Sí |
| `STRIPE_SECRET_KEY` | Clave secreta de la API de Stripe | Sí |
| `STRIPE_WEBHOOK_SECRET` | Secreto para validar eventos de Stripe | No (Prod) |
| `RESEND_API_KEY` | Clave para envío de correos | No (Si usa emails) |

### Ejemplo de `.env.example`
```env
PORT=4000
NODE_ENV=development
FRONTEND_ORIGINS=http://localhost:3000,https://tusitio.com
FRONTEND_PUBLIC_URL=http://localhost:3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=re_...
```

## 4. Backend API
Endpoints principales documentados:

### Autenticación (`/api/auth`)
- **POST `/register`**: Registro de usuario. Cuerpo: `{ email, password, fullName }`. Otorga bono de bienvenida si está configurado.
- **POST `/login`**: Inicia sesión y establece cookie `access_token`. Cuerpo: `{ email, password }`.
- **GET `/me`**: Retorna perfil del usuario actual (basado en cookie). **Requiere Auth**.
- **POST `/logout`**: Limpia la cookie de sesión.

### Plantillas (`/api/templates`)
- **GET `/public`**: Lista plantillas activas para el catálogo.
- **POST `/`**: Crea nueva plantilla. **Requiere Auth**. Cuerpo: `{ name, slug, thumbnail_url, design_json, top }`.
- **PATCH `/:id`**: Actualización parcial. Soporta `design_json_patch` para fusiones profundas.
- **DELETE `/:id`**: Desactiva la plantilla (borrado lógico).

### Eventos (`/api/events`)
- **GET `/`**: Lista eventos del usuario autenticado.
- **POST `/`**: Crea un evento asociado al usuario.
- **GET `/public/:id`**: Retorna datos públicos del evento para la vista de invitación.

### Otros
- **GET `/api/categories`**: Lista categorías de plantillas (soporta `parent_id` para subcategorías).
- **POST `/api/stripe/create-checkout-session`**: Inicia proceso de compra de packs.

## 5. Autenticación
El sistema utiliza un flujo hibrido:
1. **Login**: Supabase valida credenciales. El backend recibe el `access_token` (JWT) y lo guarda en una **Cookie HttpOnly** llamada `access_token`.
2. **Validación (Middleware)**: El archivo `requireAuth.js` extrae el token de la cookie (o header Authorization), lo valida contra `supabase.auth.getUser(token)` e inyecta el usuario en `req.user`.
3. **Persistencia**: La sesión dura 1 hora (configurable por `maxAge`).

## 6. Módulo de plantillas
Las plantillas definen la estructura visual predeterminada de una invitación.
- **Tabla `templates`**: Contiene `design_json`, un objeto que define colores, tipografía y elementos visuales.
- **Validación**: `normalizeDesignJson` asegura que el JSON sea válido y no exceda 1MB.
- **Diferencia PUT vs PATCH**: El código implementa mayoritariamente `PATCH`. El endpoint `patchTemplate` permite actualizar campos individuales o parchear solo partes del `design_json` mediante `design_json_patch`.

## 7. Base de Datos
Esquema en Supabase con relaciones clave:

### Tablas Core
- **`categories`**: Gestión de categorías.
  - `id` (UUID), `name`, `slug` (único), `parent_id` (relación a sí misma para subcategorías).
- **`templates`**: Plantillas visuales.
  - `slug` (único), `is_active` (booleano), `design_json` (JSONB).
- **`template_categories`**: Tabla intermedia (Many-to-Many) entre `templates` y `categories`.
- **`events`**: Instancias de invitaciones creadas por usuarios.
- **`invitation_balances`**: Control de saldo de invitaciones por usuario.

## 8. Estructura del proyecto
```text
invitapop-back/
├── src/
│   ├── config/          # Configuración (Env, Supabase, Stripe)
│   ├── controllers/     # Lógica de negocio por entidad
│   ├── middlewares/     # Auth, validaciones, errores
│   ├── routes/          # Definición de endpoints Express
│   ├── services/        # Servicios externos (Email, etc)
│   ├── utils/           # Ayudantes (Imágenes, Slugs)
│   └── index.js         # Punto de entrada y configuración de app
├── Dockerfile           # Configuración de contenedor
└── package.json         # Dependencias
```

## 9. Flujo de arranque local
1. **Instalación**: `npm install`
2. **Configuración**: Copiar `.env.example` a `.env` y completar valores.
3. **Ejecución**: `npm run dev` (Inicia con nodemon en puerto 4000 por defecto).
4. **Requisitos**: Node.js 18+, Instancia de Supabase activa.

## 10. Pendientes o mejoras recomendadas
- **Inconsistencia de Nombres**: Algunos archivos usan `templateCategaries` (error tipográfico en el nombre del archivo controller).
- **Refactorización**: La lógica de RSVP en `rsvpController.js` es muy extensa (>27k caracteres), se recomienda dividir en servicios menores.
- **Seguridad**: Configurar límites de tasa (rate limiting) para endpoints de auth.
- **Validación**: Implementar una librería de esquemas (ej: Zod o Joi) para validaciones de cuerpo de request más robustas.
