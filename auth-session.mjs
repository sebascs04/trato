export class SessionClient {
  constructor(config, {storage = globalThis.sessionStorage, fetchFn = globalThis.fetch.bind(globalThis)} = {}) {
    const url = new URL(config.supabase_url);
    if (url.protocol !== 'https:' || !config.publishable_key.startsWith('sb_publishable_')) throw new Error('Configuración de acceso inválida.');
    this.config = config; this.storage = storage; this.fetch = fetchFn;
    this.key = `trato:${url.hostname}:session`; this.refreshing = null;
    try {this.session = JSON.parse(storage.getItem(this.key) || 'null');} catch {this.session = null;}
  }
  save(payload) {
    if (typeof payload.access_token !== 'string' || typeof payload.refresh_token !== 'string') return false;
    this.session = {access_token:payload.access_token, refresh_token:payload.refresh_token,
      expires_at:payload.expires_at || Math.floor(Date.now()/1000) + payload.expires_in,
      user:{id:payload.user?.id, email:payload.user?.email}};
    this.storage.setItem(this.key, JSON.stringify(this.session)); return true;
  }
  clear() {this.session = null; this.storage.removeItem(this.key);}
  async auth(path, body, token) {
    const response = await this.fetch(this.config.supabase_url + '/auth/v1/' + path, {
      method:'POST', headers:{apikey:this.config.publishable_key, 'Content-Type':'application/json',
        ...(token ? {Authorization:`Bearer ${token}`} : {})}, body:JSON.stringify(body), signal:AbortSignal.timeout(15000)});
    let payload = {};
    try {payload = await response.json();} catch { /* Never expose raw Auth responses. */ }
    if (!response.ok) {
      const messages = {email_not_confirmed:'Confirma tu correo antes de iniciar sesión.',
        invalid_credentials:'Correo o contraseña incorrectos.', over_email_send_rate_limit:'Se alcanzó el límite de correos. Espera antes de reintentar.'};
      throw new Error(messages[payload.error_code || payload.code] || 'No se pudo completar el acceso. Revisa los datos o vuelve a intentar.');
    }
    return payload;
  }
  async login(email, password) {if (!this.save(await this.auth('token?grant_type=password', {email,password}))) throw new Error('Sesión inválida.');}
  async signup(email, password) {return this.save(await this.auth('signup', {email,password}));}
  async refresh() {
    if (!this.session?.refresh_token) throw new Error('Inicia sesión para continuar.');
    if (!this.refreshing) this.refreshing = this.auth('token?grant_type=refresh_token', {refresh_token:this.session.refresh_token})
      .then(payload => {if (!this.save(payload)) throw new Error('Sesión inválida.');})
      .catch(error => {this.clear(); throw error;}).finally(() => {this.refreshing = null;});
    return this.refreshing;
  }
  async token() {
    if (!this.session) throw new Error('Inicia sesión para continuar.');
    if (this.session.expires_at <= Date.now()/1000 + 30) await this.refresh();
    return this.session.access_token;
  }
  async logout() {
    const token = this.session?.access_token; this.clear();
    if (token) {try {await this.auth('logout', {}, token);} catch { /* Local session cleared. */ }}
  }
}

export async function apiRequest(session, base, path, options = {}, asBlob = false) {
  const send = async () => session.fetch(new URL(path, base), {...options,
    headers:{...options.headers, Authorization:`Bearer ${await session.token()}`}, signal:AbortSignal.timeout(60000)});
  let response = await send();
  if (response.status === 401) {await session.refresh(); response = await send();}
  if (response.ok && asBlob) return response.blob();
  let payload;
  try {payload = await response.json();} catch {throw new Error('La API devolvió una respuesta inválida.');}
  if (!response.ok) {
    const messages = {PROJECT_HAS_OPEN_REQUEST:'Este proyecto ya tiene un pedido abierto. Termínalo o ciérralo antes de registrar otro.', REQUEST_ALREADY_CLOSED:'Este pedido ya está cerrado y solo permite consulta.', ACCEPTED_CHANGE_REQUIRES_REVIEW:'La aceptación ya fue registrada. Requiere revisión del acuerdo antes de cerrarlo.', BACKEND_COMMANDS_NOT_CONFIGURED:'Falta configurar la clave de servidor en trato-api.', PROPOSAL_REVISION_CONFLICT:'Esta versión cambió. Actualiza el seguimiento.', ACCEPTANCE_REQUIRED:'Primero registra y revisa la aceptación de esta adenda.', ADENDA_SEND_REQUIRED:'Primero envía esta versión de la adenda.', EMAIL_DELIVERY_UNCERTAIN:'El resultado del envío es incierto. No se reenviará automáticamente.', EMAIL_PREVIEW_CHANGED:'El correo o su destinatario cambió. Vuelve a revisarlo.', CHANGE_READ_ONLY:'Este cambio finalizado solo permite consulta.', PROJECT_NOT_FOUND:'No tienes acceso a ese proyecto.', CLIENT_NOT_FOUND:'No tienes acceso a ese cliente.',
      DOCUMENT_NOT_FOUND:'No tienes acceso a ese documento.', FORMAT_MISMATCH:'El contenido no coincide con el formato del archivo.',
      NO_EXTRACTABLE_TEXT:'No se encontró texto. La lectura de imágenes todavía no está disponible.',
      UNSUPPORTED_FORMAT:'Selecciona un PDF o DOCX compatible.', REQUEST_TOO_LARGE:'El archivo supera 10 MB.',
      ORIGINAL_HASH_MISMATCH:'El original guardado no coincide con el documento registrado.',
      FILE_PROCESSOR_UNAVAILABLE:'El archivo está registrado, pero el procesador no está disponible. Puedes reintentar desde Documentos.'};
    throw new Error(messages[payload.error?.code] || 'No se pudo completar la operación. Actualiza la lista antes de reintentar.');
  }
  return payload.data;
}
