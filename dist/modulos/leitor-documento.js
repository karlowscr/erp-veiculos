import { falhar, texto } from '../util/comum.js';
import { chassiValido, placaValida, renavamValido, limparDoc, soDigitos, docValido } from '../util/validacao.js';
/**
 * Leitura do documento do veículo (CRV verde antigo, CRLV, CRLV-e branco em
 * papel ou PDF, ATPV-e) pela API da Anthropic (Claude, com visão).
 * Configure ANTHROPIC_API_KEY no servidor. Sem a chave, o cadastro continua
 * funcionando com digitação manual.
 */
const URL_API = process.env.ANTHROPIC_URL ?? 'https://api.anthropic.com/v1/messages';
export const leituraDisponivel = () => !!process.env.ANTHROPIC_API_KEY;
const CAMPOS = {
    tipo_documento: { type: 'string', enum: ['CRV', 'CRLV', 'CRLV-e', 'ATPV-e', 'outro', 'ilegivel'], description: 'CRV = certificado de registro verde (com campo de transferência no verso); CRLV = licenciamento antigo verde; CRLV-e = documento branco novo (papel A4 ou PDF); ATPV-e = autorização de transferência' },
    placa: { type: 'string', description: 'Placa sem traço, ex.: ABC1234 ou ABC1D23' },
    renavam: { type: 'string', description: 'Código RENAVAM, só números (9 a 11 dígitos)' },
    chassi: { type: 'string', description: 'Chassi/VIN de 17 caracteres, sem espaços' },
    marca: { type: 'string', description: 'Marca comercial por extenso, ex.: Volkswagen (para VW), Chevrolet (para GM/CHEV), Fiat, Honda, Mercedes-Benz (M.BENZ)' },
    modelo: { type: 'string', description: 'Nome do modelo sem a marca, ex.: GOL, ARGO, ONIX, CG 160 FAN' },
    versao: { type: 'string', description: 'Restante da descrição após o modelo, ex.: DRIVE 1.3, 1.0 LT, TITAN' },
    marca_modelo_documento: { type: 'string', description: 'Campo MARCA/MODELO/VERSÃO exatamente como escrito no documento' },
    ano_fab: { type: 'integer' },
    ano_mod: { type: 'integer' },
    cor: { type: 'string', description: 'Cor predominante, ex.: BRANCA, PRATA, PRETA' },
    combustivel: { type: 'string', enum: ['flex', 'gasolina', 'etanol', 'diesel', 'eletrico', 'hibrido', 'gnv', ''], description: 'ALCOOL/GASOLINA = flex' },
    combustivel_documento: { type: 'string' },
    tipo_veiculo: { type: 'string', enum: ['automovel', 'moto', 'caminhonete', 'caminhao', 'utilitario', 'outro'], description: 'MOTOCICLETA/MOTONETA/CICLOMOTOR = moto' },
    especie_tipo: { type: 'string', description: 'Ex.: PASSAGEIRO AUTOMOVEL, CARGA CAMINHONETE' },
    categoria: { type: 'string', description: 'PARTICULAR, ALUGUEL etc.' },
    potencia: { type: 'string', description: 'Potência/cilindrada como no documento, ex.: 101CV/1332CC' },
    cilindrada: { type: 'string', description: 'Só as cilindradas em cc, se houver' },
    capacidade: { type: 'string', description: 'Lotação/capacidade, ex.: 5L' },
    motor: { type: 'string', description: 'Número do motor, se houver' },
    proprietario_nome: { type: 'string' },
    proprietario_doc: { type: 'string', description: 'CPF ou CNPJ do proprietário, só números' },
    municipio: { type: 'string', description: 'Local / município do registro' },
    uf: { type: 'string', description: 'UF com 2 letras' },
    exercicio: { type: 'string', description: 'Ano de exercício do licenciamento' },
    numero_crv: { type: 'string', description: 'Número do CRV / código de segurança do CRV, se aparecer' },
    observacoes: { type: 'string', description: 'Campo de observações do documento (alienação fiduciária, restrições, remarcado etc.)' },
    alienacao_fiduciaria: { type: 'boolean', description: 'true se o documento menciona alienação fiduciária ou gravame' },
    campos_incertos: { type: 'array', items: { type: 'string' }, description: 'Nomes dos campos que você não conseguiu ler com segurança' },
};
const INSTRUCOES = `Você lê documentos de veículos brasileiros (CRV, CRLV, CRLV-e, ATPV-e) para cadastrar o veículo no estoque de uma loja.
Extraia os dados exatamente como impressos. Nunca invente: se um campo não aparece ou está ilegível, deixe vazio e cite-o em campos_incertos.
Confira o chassi (17 caracteres, sem I, O, Q) e a placa (padrão antigo ABC1234 ou Mercosul ABC1D23).
Se a imagem não for um documento de veículo, use tipo_documento "outro". Responda chamando a ferramenta registrar_documento.`;
/** Ajusta e confere o que veio da leitura, avisando o que precisa de revisão. */
export function conferirLeitura(d) {
    const avisos = [];
    const out = { ...d };
    out.placa = limparDoc(d.placa).slice(0, 7);
    out.chassi = limparDoc(d.chassi).replace(/[IOQ]/g, (c) => ({ I: '1', O: '0', Q: '0' }[c]));
    out.renavam = soDigitos(d.renavam);
    if (out.renavam && out.renavam.length < 11)
        out.renavam = out.renavam.padStart(11, '0');
    out.proprietario_doc = soDigitos(d.proprietario_doc);
    out.uf = texto(d.uf).toUpperCase().slice(0, 2);
    for (const k of ['marca', 'modelo', 'versao', 'cor', 'motor', 'potencia', 'cilindrada', 'proprietario_nome', 'municipio'])
        out[k] = texto(d[k]);
    const anoAtual = new Date().getFullYear();
    if (!(out.ano_fab >= 1950 && out.ano_fab <= anoAtual + 1)) {
        if (d.ano_fab)
            avisos.push('Ano de fabricação estranho; confira.');
        out.ano_fab = null;
    }
    if (!(out.ano_mod >= 1950 && out.ano_mod <= anoAtual + 2)) {
        if (d.ano_mod)
            avisos.push('Ano modelo estranho; confira.');
        out.ano_mod = null;
    }
    if (out.chassi && !chassiValido(out.chassi))
        avisos.push('O chassi lido não tem 17 caracteres válidos; confira no documento.');
    if (out.placa && !placaValida(out.placa))
        avisos.push('A placa lida não está no formato ABC1234/ABC1D23; confira.');
    if (out.renavam && !renavamValido(out.renavam))
        avisos.push('O RENAVAM lido não confere (dígito verificador); confira número por número.');
    if (out.proprietario_doc && !docValido(out.proprietario_doc))
        avisos.push('O CPF/CNPJ do proprietário não confere; confira.');
    if (d.alienacao_fiduciaria)
        avisos.push('O documento indica alienação fiduciária (veículo financiado). Confirme a baixa do gravame antes de comprar.');
    const incertos = Array.isArray(d.campos_incertos) ? d.campos_incertos.map(String) : [];
    if (incertos.length)
        avisos.push('Revise com atenção: ' + incertos.join(', ') + '.');
    return { dados: out, avisos };
}
export async function lerDocumentoVeiculo(arquivo, buscar = fetch) {
    const chave = process.env.ANTHROPIC_API_KEY;
    if (!chave)
        falhar('Leitura automática desligada: falta configurar ANTHROPIC_API_KEY no servidor. Preencha os dados manualmente.', 503);
    const modelo = process.env.ANTHROPIC_MODELO || 'claude-sonnet-5-5';
    const midia = arquivo.tipo === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: arquivo.buf.toString('base64') } }
        : { type: 'image', source: { type: 'base64', media_type: arquivo.tipo, data: arquivo.buf.toString('base64') } };
    const corpo = {
        model: modelo,
        max_tokens: 1500,
        system: INSTRUCOES,
        tools: [{ name: 'registrar_documento', description: 'Registra os dados lidos do documento do veículo.', input_schema: { type: 'object', properties: CAMPOS, required: ['tipo_documento'] } }],
        tool_choice: { type: 'tool', name: 'registrar_documento' },
        messages: [{ role: 'user', content: [midia, { type: 'text', text: 'Leia este documento de veículo e registre os dados.' }] }],
    };
    let r;
    try {
        r = await buscar(URL_API, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify(corpo),
            signal: AbortSignal.timeout(60_000),
        });
    }
    catch {
        return falhar('Não foi possível falar com o serviço de leitura agora. Tente de novo ou preencha manualmente.', 502);
    }
    if (!r.ok) {
        const t = await r.text().catch(() => '');
        console.error('[leitura de documento] erro da API', r.status, t.slice(0, 500));
        if (r.status === 401 || r.status === 403)
            falhar('A chave ANTHROPIC_API_KEY do servidor foi recusada. Confira a configuração.', 502);
        if (r.status === 429 || r.status === 529)
            falhar('Serviço de leitura ocupado. Tente de novo em alguns segundos.', 503);
        falhar('O serviço de leitura não conseguiu processar este arquivo. Tente uma foto mais nítida.', 502);
    }
    const resp = await r.json();
    const uso = (resp.content ?? []).find((c) => c.type === 'tool_use');
    if (!uso?.input)
        falhar('Não consegui ler o documento. Tente uma foto mais nítida, de frente e com boa luz.', 422);
    if (uso.input.tipo_documento === 'outro' || uso.input.tipo_documento === 'ilegivel') {
        falhar(uso.input.tipo_documento === 'outro' ? 'A imagem não parece ser um documento de veículo (CRV/CRLV).' : 'Documento ilegível. Tire outra foto mais nítida, sem reflexo.', 422);
    }
    const { dados, avisos } = conferirLeitura(uso.input);
    return { dados, avisos, modelo };
}
