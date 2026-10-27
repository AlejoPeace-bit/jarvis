# Jarvis — tu asistente personal por voz

App propia (PWA instalable) + servidor Node con Claude como cerebro. Le hablas y actúa sobre tu agenda de Google, tu Gmail, tus flujos de n8n y, cuando lo conectes, tu casa con Home Assistant.

```
Celular / PC ──voz──▶ PWA (public/) ──HTTPS──▶ Servidor (server/) ──▶ Claude (API)
                                                     │
                       Google Calendar + Gmail ◀─────┼─────▶ n8n (webhooks)
                                                     └─────▶ Home Assistant
```

## Lo que necesitas

- Tu VPS con EasyPanel (o cualquier sitio donde corra Docker / Node 20+).
- Tu API key de Anthropic.
- Un cliente OAuth de Google (gratis) para Calendar y Gmail.
- Un dominio o subdominio con HTTPS (EasyPanel lo da). El micrófono del navegador solo funciona en HTTPS.

## 1. Google Cloud (10 minutos, una sola vez)

1. Entra a [console.cloud.google.com](https://console.cloud.google.com) y crea un proyecto `Jarvis` (o reutiliza el que usas con n8n).
2. **APIs y servicios → Biblioteca**: habilita **Google Calendar API** y **Gmail API**.
3. **Pantalla de consentimiento OAuth**: tipo *Externo*, nombre `Jarvis`, y en **Usuarios de prueba** agrega tu correo (el de la agenda y el Gmail que quieres usar).
4. **Credenciales → Crear credencial → ID de cliente OAuth** → tipo *Aplicación web*.
   - URI de redirección autorizada: `https://TU-DOMINIO/auth/google/callback`
5. Copia el **Client ID** y el **Client Secret**.

## 2. Desplegar en EasyPanel

1. Sube esta carpeta a un repositorio de GitHub (privado está bien).
2. En EasyPanel: **Create Service → App** → fuente *GitHub* → tu repo → Build: *Dockerfile*.
3. **Environment**: pega el contenido de `.env.example` con tus valores. Obligatorias:
   `JARVIS_PASSWORD`, `ANTHROPIC_API_KEY`, `PUBLIC_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
4. **Mounts → Volume**: nombre `jarvis-data`, ruta de montaje `/data` (ahí viven la memoria, las sesiones y el token de Google; sin esto se pierden en cada despliegue).
5. **Domains**: agrega tu subdominio con HTTPS, puerto `3000`.
6. Deploy.

Sin Docker: `npm ci && cp .env.example .env` (edítalo) `&& npm start`.

## 3. Primer arranque

1. Abre `https://TU-DOMINIO` → en **Ajustes** escribe la clave (`JARVIS_PASSWORD`) y guarda.
2. Conecta Google una sola vez: abre `https://TU-DOMINIO/auth/google?key=TU_CLAVE`, acepta los permisos. Verás "Google conectado".
3. Vuelve a la app: el chip **Google conectado** debe estar en verde.
4. Instálala: en Android/Chrome *Agregar a pantalla de inicio*; en iPhone/Safari *Compartir → Agregar a inicio*; en PC el ícono de instalar en la barra de direcciones.

Pruébalo: *"¿Qué tengo mañana?"*, *"Agéndame visita de obra el martes a las diez en la bodega"*, *"¿Tengo correos importantes?"*, *"Recuerda que el contador es Jorge, su correo es…"*.

## Voz

- **Micrófono**: usa el reconocimiento del navegador (Chrome, Edge y Safari). Toca el micrófono, habla y se envía solo al terminar.
- **Manos libres** (icono de audífonos): al terminar de responder vuelve a escuchar. Ideal con el celular en un soporte o una tablet en la pared.
- **Voz de respuesta**: en Ajustes puedes elegir la voz del sistema (las "Google español" en Android y las "Mónica/Paulina/Jorge" en Apple suenan bien) y la velocidad.
- En escritorio, mantén presionada la **barra espaciadora** para hablar.

## Conectar tus flujos de n8n

Cada flujo con un *Webhook* en n8n puede ser una herramienta. Defínelos en la variable `N8N_FLOWS` (JSON) o en el archivo `/data/flujos.json`:

```json
[
  {
    "nombre": "registrar_gasto",
    "descripcion": "Registra un gasto en la hoja familiar. Datos: monto (número en pesos), categoria, descripcion",
    "url": "https://TU-N8N/webhook/registrar-gasto"
  },
  {
    "nombre": "publicar_instagram",
    "descripcion": "Programa una publicación. Datos: marca (paz_puerto | 3p | consultorio), texto",
    "url": "https://TU-N8N/webhook/publicar",
    "cabeceras": { "x-jarvis-token": "algo-secreto" }
  }
]
```

Jarvis envía un `POST` con JSON `{ "origen": "jarvis", ...datos }`. Lo que el webhook responda, Jarvis se lo cuenta al usuario. Reinicia el servicio después de cambiar la variable.

## Conectar la casa (Home Assistant)

Cuando tengas Home Assistant:

1. En HA: **Perfil → Seguridad → Tokens de acceso de larga duración → Crear**.
2. Variables: `HA_URL=https://tu-home-assistant` (debe ser alcanzable desde el VPS: Nabu Casa, Cloudflare Tunnel o un túnel propio) y `HA_TOKEN=...`.
3. Reinicia. Aparecen las herramientas `casa_estado` y `casa_controlar`: *"apaga las luces de la sala"*, *"pon el aire a veintidós"*, *"¿quedó algo prendido?"*.

## Estructura

```
server/
  index.js        API, autenticación, OAuth de Google, archivos estáticos
  agent.js        bucle de tool use con Claude
  prompt.js       personalidad e instrucciones de Jarvis
  memory.js       historial por sesión + memoria permanente (/data/memoria.md)
  google.js       OAuth2 y clientes de Calendar y Gmail
  tools/          una herramienta por archivo (agenda, correo, n8n, casa, hora, memoria)
public/           la PWA (index.html, app.js, styles.css, sw.js, manifest, íconos)
```

Para añadir una herramienta nueva: crea un archivo en `server/tools/` con `definition` (nombre, descripción, `input_schema`) y `execute(input)`, y agrégala en `server/tools/index.js`. Nada más.

## Seguridad

- Toda la API exige la clave (`Authorization: Bearer`). Úsala larga; el navegador la guarda en el dispositivo.
- La API key de Anthropic y el token de Google nunca llegan al celular: viven en el servidor y en el volumen `/data`.
- Enviar correos y borrar eventos requiere confirmación explícita del usuario en la conversación (regla del prompt y verificación en la herramienta de envío).
- Límite de 40 peticiones por minuto por IP.

## Próximas fases (ideas)

- Notas de voz con Whisper para transcripción más precisa que la del navegador.
- Briefing automático de la mañana (agenda + correos) enviado a Telegram o al celular.
- Palabra de activación "Jarvis" con un parlante en casa (Home Assistant Assist + wake word).
- Voz premium (ElevenLabs) para el efecto completo.
