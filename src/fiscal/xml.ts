/**
 * Montagem de XML já na forma canônica (C14N inclusiva), que é a forma
 * usada para calcular o hash da assinatura da NF-e:
 *  - nunca gera tags auto-fechadas (<a/>); elementos vazios são omitidos;
 *  - escapa no texto apenas &, <, > e \r; nos atributos &, <, ", \t, \n, \r;
 *  - não gera espaços nem quebras de linha entre as tags.
 * Assim o mesmo texto serve para transmitir e para assinar.
 */

export const escTexto = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');

export const escAttr = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;');

/** Limpa texto para a NF-e: sem caracteres de controle, espaços simples, tamanho máximo. */
export function limparTexto(v: unknown, max = 0): string {
  let s = String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (max && s.length > max) s = s.slice(0, max).trim();
  return s;
}

type Valor = string | number | null | undefined;

function atributos(a?: Record<string, Valor>): string {
  if (!a) return '';
  // C14N: atributos de namespace primeiro (xmlns), depois os demais em ordem alfabética
  const chaves = Object.keys(a).filter((k) => a[k] !== undefined && a[k] !== null);
  const ns = chaves.filter((k) => k === 'xmlns' || k.startsWith('xmlns:')).sort();
  const outros = chaves.filter((k) => !ns.includes(k)).sort();
  return [...ns, ...outros].map((k) => ` ${k}="${escAttr(String(a[k]))}"`).join('');
}

/** Elemento folha. Retorna '' se o valor for vazio. */
export function t(nome: string, valor: Valor, attrs?: Record<string, Valor>): string {
  if (valor === undefined || valor === null) return '';
  const s = typeof valor === 'number' ? String(valor) : limparTexto(valor);
  if (s === '') return '';
  return `<${nome}${atributos(attrs)}>${escTexto(s)}</${nome}>`;
}

/** Elemento com filhos (strings já montadas). Retorna '' se não houver filhos. */
export function g(nome: string, ...filhos: string[]): string {
  const c = filhos.join('');
  return c ? `<${nome}>${c}</${nome}>` : '';
}

/** Elemento com atributos e filhos; sempre gerado. */
export function ga(nome: string, attrs: Record<string, Valor>, ...filhos: string[]): string {
  return `<${nome}${atributos(attrs)}>${filhos.join('')}</${nome}>`;
}

/** Valor monetário/decimal com casas fixas. */
export const dec = (v: number, casas = 2) => (Math.round((v + Number.EPSILON) * 10 ** casas) / 10 ** casas).toFixed(casas);

/** Extrai o conteúdo do primeiro elemento com esse nome (ignora prefixo de namespace). */
export function extrair(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`).exec(xml);
  return m?.[1];
}

/** Extrai o elemento inteiro (com as tags) do primeiro elemento com esse nome. */
export function extrairElemento(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>[\\s\\S]*?</(?:\\w+:)?${tag}>`).exec(xml);
  return m?.[0];
}

/** Desfaz os escapes de entidade mais comuns (para exibir mensagens da SEFAZ). */
export function desescapar(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&');
}
