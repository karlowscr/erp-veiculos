/** Pix "copia e cola" estático (BR Code / EMV), conforme o Manual de Padrões para Iniciação do Pix. */

const campo = (id: string, valor: string) => id + String(valor.length).padStart(2, '0') + valor;

function crc16(s: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(s, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();

/** Normaliza a chave: CPF/CNPJ só dígitos, telefone com +55, e-mail e aleatória como estão. */
export function normalizarChavePix(chave: string): string {
  const c = chave.trim();
  if (!c) return '';
  if (c.includes('@')) return c.toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) return c.toLowerCase();
  const d = c.replace(/\D/g, '');
  if (c.startsWith('+')) return '+' + d;
  if (d.length === 11 || d.length === 14) return d; // CPF ou CNPJ (telefone deve vir com +55)
  if (d.length === 13 && d.startsWith('55')) return '+' + d;
  return c;
}

export function pixCopiaECola(p: { chave: string; nome: string; cidade: string; valor?: number; txid?: string; descricao?: string }): string {
  const chave = normalizarChavePix(p.chave);
  if (!chave) throw new Error('Chave Pix não informada.');
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', chave) + (p.descricao ? campo('02', semAcento(p.descricao).slice(0, 40)) : '');
  const txid = (p.txid ?? '***').replace(/[^A-Za-z0-9*]/g, '').slice(0, 25) || '***';
  let s = campo('00', '01') + campo('26', conta) + campo('52', '0000') + campo('53', '986');
  if (p.valor && p.valor > 0) s += campo('54', p.valor.toFixed(2));
  s += campo('58', 'BR') + campo('59', semAcento(p.nome).slice(0, 25) || 'LOJA') + campo('60', semAcento(p.cidade).slice(0, 15) || 'BRASIL');
  s += campo('62', campo('05', txid));
  s += '6304';
  return s + crc16(s);
}
