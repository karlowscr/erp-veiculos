import type { App } from '../http/app.js';
import type { Banco, Linha } from '../db/database.js';
import { falhar, texto, numero } from '../util/comum.js';

/**
 * Tabela FIPE pela API pública da Parallelum (https://deividfortuna.github.io/fipe/).
 * As respostas ficam guardadas no banco para não repetir consultas
 * (a FIPE só muda uma vez por mês).
 */
const BASE = process.env.FIPE_URL ?? 'https://parallelum.com.br/fipe/api/v1';
export type TipoFipe = 'carros' | 'motos' | 'caminhoes';
const TIPOS_FIPE: TipoFipe[] = ['carros', 'motos', 'caminhoes'];

export const tipoFipeDoVeiculo = (tipo: string): TipoFipe => (tipo === 'moto' ? 'motos' : tipo === 'caminhao' ? 'caminhoes' : 'carros');

export interface PrecoFipe { Valor: string; Marca: string; Modelo: string; AnoModelo: number; Combustivel: string; CodigoFipe: string; MesReferencia: string }

export class Fipe {
  constructor(private b: Banco, private buscar: typeof fetch = fetch) {}

  private async obter<T>(caminho: string, horasCache: number): Promise<T> {
    const c = this.b.one(`SELECT valor FROM fipe_cache WHERE chave = ? AND criado_em > datetime('now', ?)`, [caminho, `-${horasCache} hours`]);
    if (c) return JSON.parse(c.valor);
    let r: Response;
    try {
      r = await this.buscar(BASE + caminho, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
    } catch {
      const velho = this.b.one('SELECT valor FROM fipe_cache WHERE chave = ?', [caminho]);
      if (velho) return JSON.parse(velho.valor);
      return falhar('Não foi possível consultar a FIPE agora (sem conexão). Tente de novo em instantes.', 502);
    }
    if (r.status === 429) falhar('A consulta FIPE atingiu o limite de pedidos por hoje. Tente mais tarde.', 503);
    if (!r.ok) falhar('Não encontrado na tabela FIPE.', r.status === 404 ? 404 : 502);
    const dados = await r.json();
    this.b.run("INSERT INTO fipe_cache (chave, valor, criado_em) VALUES (?, ?, datetime('now')) ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor, criado_em = excluded.criado_em", [caminho, JSON.stringify(dados)]);
    return dados as T;
  }

  marcas(tipo: TipoFipe) { return this.obter<{ codigo: string; nome: string }[]>(`/${tipo}/marcas`, 24 * 15); }
  async modelos(tipo: TipoFipe, marca: string) {
    return (await this.obter<{ modelos: { codigo: number; nome: string }[] }>(`/${tipo}/marcas/${marca}/modelos`, 24 * 7)).modelos;
  }
  anos(tipo: TipoFipe, marca: string, modelo: string) {
    return this.obter<{ codigo: string; nome: string }[]>(`/${tipo}/marcas/${marca}/modelos/${modelo}/anos`, 24 * 7);
  }
  preco(tipo: TipoFipe, marca: string, modelo: string, ano: string) {
    return this.obter<PrecoFipe>(`/${tipo}/marcas/${marca}/modelos/${modelo}/anos/${ano}`, 24 * 3);
  }

  /**
   * Acha o veículo na FIPE a partir do que está no documento
   * (ex.: "VW/GOL 1.0", "I/FIAT ARGO DRIVE 1.3", ano 2020, flex).
   */
  async procurar(d: { tipo: TipoFipe; marca: string; modelo: string; versao?: string; ano: number; combustivel?: string }) {
    const marcas = await this.marcas(d.tipo);
    const marca = escolherMarca(marcas, d.marca, d.modelo);
    if (!marca) return { candidatos: [], marca: null };
    const modelos = await this.modelos(d.tipo, marca.codigo);
    const alvo = `${d.modelo} ${d.versao ?? ''}`;
    const ranqueados = modelos
      .map((m) => ({ ...m, pontos: semelhanca(alvo, m.nome, marca.nome) }))
      .filter((m) => m.pontos > 0)
      .sort((a, b) => b.pontos - a.pontos)
      .slice(0, 30);
    // Confere (6 de cada vez) quais dos melhores modelos existem no ano pedido
    const candidatos: { marca: string; marca_nome: string; modelo: number; modelo_nome: string; ano: string; ano_nome: string; pontos: number }[] = [];
    for (let i = 0; i < ranqueados.length && candidatos.length < 5; i += 6) {
      const lote = ranqueados.slice(i, i + 6);
      const anos = await Promise.all(lote.map((m) => this.anos(d.tipo, marca.codigo, String(m.codigo)).catch(() => [])));
      lote.forEach((m, j) => {
        const ano = escolherAno(anos[j], d.ano, d.combustivel);
        if (ano) candidatos.push({ marca: marca.codigo, marca_nome: marca.nome, modelo: m.codigo, modelo_nome: m.nome, ano: ano.codigo, ano_nome: ano.nome, pontos: m.pontos });
      });
    }
    candidatos.sort((a, b) => b.pontos - a.pontos);
    candidatos.splice(5);
    return { candidatos, marca };
  }
}

const normalizar = (s: string) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9.]+/g, ' ').trim();

/** Siglas que aparecem no documento × nome da marca na FIPE. */
const APELIDOS: Record<string, string> = {
  VW: 'VW - VOLKSWAGEN', VOLKS: 'VW - VOLKSWAGEN', VOLKSWAGEN: 'VW - VOLKSWAGEN',
  GM: 'GM - CHEVROLET', CHEV: 'GM - CHEVROLET', CHEVROLET: 'GM - CHEVROLET',
  'M.BENZ': 'MERCEDES-BENZ', MBENZ: 'MERCEDES-BENZ', MERCEDES: 'MERCEDES-BENZ', 'MB': 'MERCEDES-BENZ',
  'LR': 'LAND ROVER', 'LAND': 'LAND ROVER', 'HYUNDAI': 'HYUNDAI', 'CAOA': 'CAOA CHERY', 'JAC': 'JAC',
  'GWM': 'GWM', 'HARLEY': 'HARLEY-DAVIDSON', 'H.DAVIDSON': 'HARLEY-DAVIDSON', 'ROYAL': 'ROYAL ENFIELD',
};

function escolherMarca(marcas: { codigo: string; nome: string }[], marcaDoc: string, modeloDoc: string) {
  // Tira o "I/" de importado e separa "FIAT/ARGO"
  const bruto = normalizar(String(marcaDoc || modeloDoc).replace(/^I\s*\/\s*/i, '').split('/')[0]);
  const primeira = bruto.split(' ')[0];
  const nomes = marcas.map((m) => ({ ...m, n: normalizar(m.nome) }));
  const apelido = APELIDOS[bruto] ?? APELIDOS[primeira];
  if (apelido) {
    const a = nomes.find((m) => m.n === normalizar(apelido)) ?? nomes.find((m) => m.n.includes(normalizar(apelido)));
    if (a) return a;
  }
  return nomes.find((m) => m.n === bruto)
    ?? nomes.find((m) => m.n.split(' - ').some((p) => p === bruto || p === primeira))
    ?? nomes.find((m) => m.n.startsWith(primeira) || m.n.includes(' ' + primeira))
    ?? null;
}

/** Pontua o quanto o nome da FIPE combina com o modelo do documento. */
export function semelhanca(doc: string, fipe: string, marca = ''): number {
  const tirar = new Set(normalizar(marca).split(/[ -]+/).concat(['I', 'MOD', 'MODELO']));
  const a = normalizar(doc.replace(/^I\s*\/\s*/i, '').replace(/^[^/]*\//, '')).split(' ').filter((t) => t && !tirar.has(t));
  const bTokens = normalizar(fipe).split(' ').filter(Boolean);
  if (!a.length) return 0;
  const b = new Set(bTokens);
  let pts = 0;
  a.forEach((t, i) => {
    const peso = i === 0 ? 5 : /^\d\.\d$/.test(t) ? 3 : 1;
    if (b.has(t)) pts += peso;
    else if (t.length >= 3 && bTokens.some((x) => x.startsWith(t) || t.startsWith(x) && x.length >= 3)) pts += peso * 0.5;
  });
  if (!b.has(a[0]) && !bTokens.some((x) => x.startsWith(a[0]))) return 0; // o nome do modelo precisa bater
  return pts - bTokens.length * 0.05; // em empate, prefere o nome mais curto
}

const COMB_FIPE: Record<string, string> = { gasolina: '1', flex: '5', etanol: '2', diesel: '3' };

function escolherAno(anos: { codigo: string; nome: string }[], ano: number, combustivel?: string) {
  const doAno = anos.filter((a) => a.codigo.startsWith(`${ano}-`));
  if (!doAno.length) return null;
  const c = COMB_FIPE[combustivel ?? ''];
  return doAno.find((a) => a.codigo.endsWith('-' + c)) ?? doAno[0];
}

export const valorFipe = (v: string) => Number(String(v ?? '').replace(/[^\d,]/g, '').replace(',', '.')) || null;

/** Consulta e grava a FIPE no veículo. */
export async function atualizarFipeVeiculo(b: Banco, fipe: Fipe, v: Linha, escolha?: { tipo?: string; marca?: string; modelo?: string; ano?: string }) {
  const tipo = (TIPOS_FIPE as string[]).includes(escolha?.tipo ?? '') ? (escolha!.tipo as TipoFipe) : tipoFipeDoVeiculo(v.tipo);
  let marca = escolha?.marca, modelo = escolha?.modelo, ano = escolha?.ano;
  let candidatos: Linha[] = [];
  if (!marca || !modelo || !ano) {
    const r = await fipe.procurar({ tipo, marca: v.marca, modelo: v.modelo, versao: v.versao, ano: v.ano_mod, combustivel: v.combustivel });
    candidatos = r.candidatos;
    if (!candidatos.length) return { encontrado: false, candidatos, marca: r.marca };
    ({ marca, modelo, ano } = { marca: candidatos[0].marca, modelo: String(candidatos[0].modelo), ano: candidatos[0].ano });
  }
  const p = await fipe.preco(tipo, marca!, modelo!, ano!);
  const dados = {
    fipe_codigo: p.CodigoFipe, fipe_modelo: `${p.Marca} ${p.Modelo} ${p.AnoModelo === 32000 ? '0 km' : p.AnoModelo} ${p.Combustivel}`.trim(),
    fipe_valor: valorFipe(p.Valor), fipe_referencia: texto(p.MesReferencia),
  };
  if (v.id) b.run("UPDATE veiculos SET fipe_codigo = ?, fipe_modelo = ?, fipe_valor = ?, fipe_referencia = ?, fipe_consultado_em = datetime('now') WHERE id = ?",
    [dados.fipe_codigo, dados.fipe_modelo, dados.fipe_valor, dados.fipe_referencia, v.id]);
  return { encontrado: true, ...dados, escolha: { tipo, marca, modelo, ano }, candidatos };
}

export function registrarFipe(app: App, b: Banco, fipe = new Fipe(b)): Fipe {
  const tipoQ = (q: URLSearchParams): TipoFipe => {
    const t = q.get('tipo') ?? 'carros';
    if (!(TIPOS_FIPE as string[]).includes(t)) falhar('Tipo inválido.');
    return t as TipoFipe;
  };
  const cod = (v: string | null) => (/^[\w-]{1,20}$/.test(v ?? '') ? v! : falhar('Código inválido.'));
  app.get('/api/fipe/marcas', (req) => fipe.marcas(tipoQ(req.query)));
  app.get('/api/fipe/modelos', (req) => fipe.modelos(tipoQ(req.query), cod(req.query.get('marca'))));
  app.get('/api/fipe/anos', (req) => fipe.anos(tipoQ(req.query), cod(req.query.get('marca')), cod(req.query.get('modelo'))));
  app.get('/api/fipe/preco', async (req) => {
    const p = await fipe.preco(tipoQ(req.query), cod(req.query.get('marca')), cod(req.query.get('modelo')), cod(req.query.get('ano')));
    return { ...p, valor: valorFipe(p.Valor) };
  });
  // Procura pelo que veio do documento (sem gravar em veículo nenhum)
  app.get('/api/fipe/buscar', async (req) => {
    const q = req.query;
    const v = { tipo: q.get('tipo_veiculo') ?? 'automovel', marca: texto(q.get('marca')), modelo: texto(q.get('modelo')), versao: texto(q.get('versao')), ano_mod: numero(q.get('ano')), combustivel: texto(q.get('combustivel')) };
    if (!v.modelo || !v.ano_mod) falhar('Informe modelo e ano.');
    return atualizarFipeVeiculo(b, fipe, v);
  });
  return fipe;
}
