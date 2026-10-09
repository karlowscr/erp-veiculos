import { generateKeyPairSync, createSign, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Transporte } from './sefaz.js';
import { verificarAssinatura } from './assinatura.js';
import { dataHoraNFe } from './chave.js';

/**
 * SEFAZ simulada, ativada com NFE_SIMULADO=1 e apenas em homologação.
 * Serve para treinar a equipe e testar o fluxo sem certificado ou internet.
 * Confere a assinatura de verdade e responde como a SEFAZ responderia.
 * Notas simuladas não existem na SEFAZ e não têm valor algum.
 */
export const transporteSimulado: Transporte = {
  async enviar(_url, servico, envelope) {
    const agora = dataHoraNFe(new Date());
    const prot = () => '9' + String(Date.now()).padStart(14, '0');
    const resp = (corpo: string) => `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg>${corpo}</nfeResultMsg></soap:Body></soap:Envelope>`;
    const ns = 'xmlns="http://www.portalfiscal.inf.br/nfe"';
    if (servico === 'status') return resp(`<retConsStatServ ${ns} versao="4.00"><tpAmb>2</tpAmb><cStat>107</cStat><xMotivo>Servico em Operacao (SIMULADO)</xMotivo></retConsStatServ>`);
    if (servico === 'autorizacao') {
      const nfe = /<NFe [\s\S]*<\/NFe>/.exec(envelope)![0];
      const chave = /Id="NFe(\w{44})"/.exec(nfe)![1];
      const v = verificarAssinatura(nfe, 'infNFe');
      const [cStat, motivo] = v.ok ? ['100', 'Autorizado o uso da NF-e (SIMULADO)'] : ['297', 'Rejeicao: Assinatura difere do calculado'];
      return resp(`<retEnviNFe ${ns} versao="4.00"><tpAmb>2</tpAmb><cStat>104</cStat><xMotivo>Lote processado</xMotivo><protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SIMULADOR</verAplic><chNFe>${chave}</chNFe><dhRecbto>${agora}</dhRecbto>${cStat === '100' ? `<nProt>${prot()}</nProt>` : ''}<cStat>${cStat}</cStat><xMotivo>${motivo}</xMotivo></infProt></protNFe></retEnviNFe>`);
    }
    if (servico === 'consulta') {
      return resp(`<retConsSitNFe ${ns} versao="4.00"><tpAmb>2</tpAmb><cStat>217</cStat><xMotivo>Rejeicao: NF-e nao consta na base de dados da SEFAZ (SIMULADO)</xMotivo></retConsSitNFe>`);
    }
    if (servico === 'evento') {
      const ev = /<evento [\s\S]*<\/evento>/.exec(envelope)![0];
      const ok = verificarAssinatura(ev, 'infEvento').ok;
      const tp = /<tpEvento>(\d+)<\/tpEvento>/.exec(ev)![1];
      const chave = /<chNFe>(\w+)<\/chNFe>/.exec(ev)![1];
      const seq = /<nSeqEvento>(\d+)<\/nSeqEvento>/.exec(ev)![1];
      return resp(`<retEnvEvento ${ns} versao="1.00"><cStat>128</cStat><xMotivo>Lote de Evento Processado</xMotivo><retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><cStat>${ok ? '135' : '297'}</cStat><xMotivo>${ok ? 'Evento registrado e vinculado a NF-e (SIMULADO)' : 'Rejeicao: Assinatura difere do calculado'}</xMotivo><chNFe>${chave}</chNFe><tpEvento>${tp}</tpEvento><nSeqEvento>${seq}</nSeqEvento><dhRegEvento>${agora}</dhRegEvento>${ok ? `<nProt>${prot()}</nProt>` : ''}</infEvento></retEvento></retEnvEvento>`);
    }
    throw new Error('Serviço não simulado: ' + servico);
  },
};

/** Gera (uma vez) um certificado autoassinado para o modo simulado, só com o Node. */
export function certificadoSimulado(pasta: string): string {
  const arq = join(pasta, 'simulado.pem');
  if (!existsSync(arq)) {
    mkdirSync(pasta, { recursive: true });
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const tlv = (tag: number, conteudo: Buffer) => {
      const n = conteudo.length;
      const len = n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]);
      return Buffer.concat([Buffer.from([tag]), len, conteudo]);
    };
    const seq = (...p: Buffer[]) => tlv(0x30, Buffer.concat(p));
    const oid = (hex: string) => tlv(0x06, Buffer.from(hex, 'hex'));
    const sha256Rsa = seq(oid('2a864886f70d01010b'), Buffer.from([0x05, 0x00]));
    const nome = seq(tlv(0x31, seq(oid('550403'), tlv(0x0c, Buffer.from('CERTIFICADO SIMULADO SEM VALOR:00000000000000', 'utf8')))));
    const tempo = (d: Date) => tlv(0x18, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z'));
    const agora = new Date();
    const tbs = seq(
      tlv(0xa0, tlv(0x02, Buffer.from([2]))),
      tlv(0x02, Buffer.concat([Buffer.from([0x01]), randomBytes(8)])),
      sha256Rsa, nome, seq(tempo(agora), tempo(new Date(agora.getTime() + 3650 * 86400000))), nome,
      publicKey.export({ type: 'spki', format: 'der' }),
    );
    const assinatura = createSign('sha256').update(tbs).sign(privateKey);
    const cert = seq(tbs, sha256Rsa, tlv(0x03, Buffer.concat([Buffer.from([0]), assinatura])));
    const pemCert = `-----BEGIN CERTIFICATE-----\n${cert.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
    writeFileSync(arq, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() + pemCert, { mode: 0o600 });
  }
  return arq;
}
