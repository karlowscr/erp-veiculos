export class ErroApi extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

let aoDeslogar: () => void = () => undefined;
export const definirAoDeslogar = (fn: () => void) => (aoDeslogar = fn);

async function chamar<T>(metodo: string, url: string, corpo?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: metodo,
    credentials: 'same-origin',
    headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const tipo = r.headers.get('content-type') ?? '';
  const dados = tipo.includes('json') ? await r.json() : await r.text();
  if (!r.ok) {
    if (r.status === 401 && !url.endsWith('/login')) aoDeslogar();
    throw new ErroApi((dados as any)?.erro ?? `Erro ${r.status}`, r.status);
  }
  return dados as T;
}

export const api = {
  get: <T = any>(url: string) => chamar<T>('GET', url),
  post: <T = any>(url: string, corpo: unknown = {}) => chamar<T>('POST', url, corpo),
  put: <T = any>(url: string, corpo: unknown) => chamar<T>('PUT', url, corpo),
  del: <T = any>(url: string) => chamar<T>('DELETE', url),
};

export interface Usuario {
  id: number;
  nome: string;
  email: string;
  perfil: 'admin' | 'gerente' | 'vendedor' | 'financeiro';
  admin: boolean;
  permissoes: string[];
  dois_fatores: boolean;
}

export const sessao: { usuario?: Usuario } = {};
/** Verdadeiro se o usuário tem pelo menos uma das permissões (o administrador tem todas). */
export const pode = (...permissoes: string[]) =>
  !!sessao.usuario && (sessao.usuario.admin || permissoes.some((p) => sessao.usuario!.permissoes.includes(p)));
export const ehAdmin = () => !!sessao.usuario?.admin;
