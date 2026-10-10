import type { Linha } from '../db/database.js';
import { pagina, cabecalho, esc, moeda, dataBr, dataExtenso, docFmt, nomeLoja } from './base.js';
import { valorPorExtenso } from '../util/extenso.js';

const FORMAS: Record<string, string> = {
  pix: 'Pix', dinheiro: 'dinheiro', cartao_debito: 'cartão de débito', cartao_credito: 'cartão de crédito', cartao: 'cartão',
  transferencia: 'transferência bancária', boleto: 'boleto', financiamento: 'financiamento', promissoria: 'nota promissória', cheque: 'cheque',
};

/**
 * Recibo / comprovante de pagamento com a identidade da loja.
 * Conta a receber paga = "Recebemos de…"; conta a pagar paga = "Pagamos a…".
 */
export function htmlRecibo(t: Linha, e: Linha, pessoa: Linha | undefined, extra: { numero: string; emitidoPor?: string; unicaVia?: boolean }): string {
  const valor = Number(t.valor_pago ?? t.valor);
  const recebimento = t.tipo === 'receber';
  const nomePessoa = pessoa?.nome || (t.cliente_nome as string) || '—';
  const docPessoa = pessoa?.cpf_cnpj ? `, CPF/CNPJ ${docFmt(pessoa.cpf_cnpj)}` : '';
  const forma = FORMAS[t.forma] ?? t.forma ?? '';
  const loja = e.razao_social || nomeLoja(e);
  const frase = recebimento
    ? `Recebemos de <b>${esc(nomePessoa)}</b>${esc(docPessoa)} a importância de <b>${moeda(valor)}</b> (${esc(valorPorExtenso(valor))}), referente a <b>${esc(t.descricao)}</b>${forma ? `, pago em ${esc(forma)}` : ''}, dando plena e geral quitação pelo valor recebido.`
    : `Declaramos que <b>${esc(loja)}</b> pagou a <b>${esc(nomePessoa)}</b>${esc(docPessoa)} a importância de <b>${moeda(valor)}</b> (${esc(valorPorExtenso(valor))}), referente a <b>${esc(t.descricao)}</b>${forma ? `, pago em ${esc(forma)}` : ''}.`;
  const via = (nome: string) => `<section class="via">
    ${cabecalho(e, recebimento ? 'RECIBO' : 'COMPROVANTE DE PAGAMENTO', `Nº ${esc(extra.numero)} · ${nome}`)}
    <div class="valor-caixa"><span>Valor</span><b>${moeda(valor)}</b></div>
    <p class="frase">${frase}</p>
    <div class="grade">
      <div><span>Data do pagamento</span><b>${dataBr(t.pago_em)}</b></div>
      <div><span>Vencimento</span><b>${dataBr(t.vencimento)}</b></div>
      <div><span>Parcela</span><b>${t.total_parcelas > 1 ? `${t.parcela}/${t.total_parcelas}` : 'Única'}</b></div>
      <div><span>Forma</span><b>${esc(forma || '—')}</b></div>
    </div>
    <p class="local">${esc(e.cidade_contrato || [e.municipio, e.uf].filter(Boolean).join('/'))}, ${dataExtenso(String(t.pago_em ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10))}.</p>
    <div class="ass">${recebimento && e.assinatura_loja ? `<img src="${esc(e.assinatura_loja)}" alt="">` : '<div class="vazio"></div>'}
      <div class="linha">${recebimento ? `<b>${esc(loja)}</b>${e.cnpj ? `<br>CNPJ ${docFmt(e.cnpj)}` : ''}` : `<b>${esc(nomePessoa)}</b><br>Recebedor`}</div></div>
    ${extra.emitidoPor ? `<p class="rodape">Emitido por ${esc(extra.emitidoPor)} em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })}</p>` : ''}
  </section>`;
  return pagina(`Recibo ${extra.numero} — ${nomePessoa}`, extra.unicaVia ? `<div class="folha">${via('Comprovante do cliente')}</div>` : `<div class="folha">${via('Via do cliente')}<div class="corte">✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -</div>${via('Via da loja')}</div>`, `
.via{page-break-inside:avoid}
.valor-caixa{float:right;border:2px solid #f97316;border-radius:8px;padding:4px 14px;text-align:right;margin:0 0 8px 14px}
.valor-caixa span{display:block;font-size:7.5pt;color:#6b7487}.valor-caixa b{font-size:14pt}
.frase{font-size:11pt;line-height:1.7;text-align:justify;margin:6px 0 12px}
.local{text-align:right;margin:12px 0 0}
.ass{width:60%;margin:26px auto 0;text-align:center;font-size:9pt}.ass img{height:56px;max-width:100%;object-fit:contain;display:block;margin:0 auto -4px}
.ass .vazio{height:44px}.ass .linha{border-top:1px solid #1d2433;padding-top:4px}
.corte{text-align:center;color:#9aa3b2;margin:18px 0;font-size:9pt;overflow:hidden;white-space:nowrap}
.grade{grid-template-columns:repeat(4,1fr)}`);
}
