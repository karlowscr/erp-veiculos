/**
 * Coloca 3 veículos de demonstração no catálogo, com fotos, FIPE e texto,
 * para ver como o site fica. Para tirar: npm run demo -- remover
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { Banco } from '../db/database.js';
import { validarVeiculo } from '../modulos/veiculos.js';
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MARCA = 'DEMONSTRAÇÃO (npm run demo -- remover)';
const hoje = new Date();
const diasAtras = (n) => new Date(hoje.getTime() - n * 86400_000).toISOString().slice(0, 10);
const VEICULOS = [
    {
        fotos: 'argo', destaque: 1, data_entrada: diasAtras(3),
        dados: { tipo: 'automovel', marca: 'FIAT', modelo: 'ARGO', versao: 'DRIVE 1.3', ano_fab: 2020, ano_mod: 2020, cor: 'BRANCA', combustivel: 'flex', cambio: 'manual',
            placa: 'DEM0A01', chassi: '9BD0DEM0000000001', renavam: '00948273615', km: 45200, portas: 4, potencia: '109 cv', preco_venda: 64900, preco_minimo: 61500,
            opcionais: 'Ar-condicionado, Direção elétrica, Central multimídia com Android Auto e Apple CarPlay, Câmera de ré, Sensor de estacionamento, Vidros e travas elétricas, Volante multifuncional, Rodas de liga leve' },
        preco_compra: 52000, fipe: { fipe_valor: 69900, fipe_codigo: '001493-1', fipe_modelo: 'Fiat ARGO DRIVE 1.3 8V Flex 2020', fipe_referencia: 'outubro de 2026' },
        texto: 'Único dono, todas as revisões na concessionária, manual e chave reserva. Pneus novos e IPVA 2026 pago. Aceitamos seu usado na troca.',
    },
    {
        fotos: 'hrv', destaque: 0, data_entrada: diasAtras(12),
        dados: { tipo: 'automovel', marca: 'HONDA', modelo: 'HR-V', versao: 'EXL 1.8 CVT', ano_fab: 2019, ano_mod: 2019, cor: 'VERMELHA', combustivel: 'flex', cambio: 'cvt',
            placa: 'DEM0B02', chassi: '9BD0DEM0000000002', renavam: '01059384725', km: 68400, portas: 4, potencia: '140 cv', preco_venda: 104900, preco_minimo: 99900,
            opcionais: 'Bancos de couro, Teto solar, Ar-condicionado digital, Câmera de ré, Piloto automático, Partida sem chave, Faróis de LED, Seis airbags' },
        preco_compra: 88000, fipe: { fipe_valor: 108600, fipe_codigo: '014085-6', fipe_modelo: 'Honda HR-V EXL 1.8 Flexone 16V 5p Aut. 2019', fipe_referencia: 'outubro de 2026' },
        texto: 'SUV completo e econômico na cidade. Laudo cautelar aprovado, sem detalhes de lataria.',
    },
    {
        fotos: 'hilux', destaque: 0, data_entrada: diasAtras(25),
        dados: { tipo: 'caminhonete', marca: 'TOYOTA', modelo: 'HILUX', versao: 'CD SRV 4X4 2.8 DIESEL', ano_fab: 2018, ano_mod: 2018, cor: 'PRATA', combustivel: 'diesel', cambio: 'automatico',
            placa: 'DEM0C03', chassi: '9BD0DEM0000000003', renavam: '01128374657', km: 112000, portas: 4, potencia: '177 cv', preco_venda: 189900, preco_minimo: 182000,
            opcionais: 'Tração 4x4, Câmbio automático, Bancos de couro, Engate, Capota marítima, Protetor de caçamba, Controle de estabilidade' },
        preco_compra: 165000, fipe: { fipe_valor: 181300, fipe_codigo: '002110-5', fipe_modelo: 'Toyota Hilux CD SRV 4x4 2.8 TDI Diesel Aut. 2018', fipe_referencia: 'outubro de 2026' },
        texto: 'Pronta para o trabalho e para a estrada. Revisada, com pneus de uso misto.',
    },
];
export function removerDemo(b, pastaFotos) {
    const lista = b.all('SELECT id FROM veiculos WHERE obs = ?', [MARCA]);
    for (const v of lista) {
        for (const f of b.all('SELECT arquivo FROM veiculo_fotos WHERE veiculo_id = ?', [v.id])) {
            const arq = join(pastaFotos, f.arquivo);
            if (existsSync(arq))
                unlinkSync(arq);
        }
        b.run('DELETE FROM contatos_site WHERE veiculo_id = ?', [v.id]);
        b.run('DELETE FROM veiculo_fotos WHERE veiculo_id = ?', [v.id]);
        b.run('DELETE FROM veiculos WHERE id = ?', [v.id]);
    }
    return lista.length;
}
/** Coloca os veículos de demonstração (com fotos) no banco informado. */
export function semearDemo(b, pastaFotos) {
    removerDemo(b, pastaFotos);
    mkdirSync(pastaFotos, { recursive: true });
    for (const v of VEICULOS) {
        const dados = validarVeiculo(v.dados);
        const id = b.inserir('veiculos', {
            ...dados, obs: MARCA, origem: 'compra', situacao: 'estoque', preco_compra: v.preco_compra, data_entrada: v.data_entrada,
            publicado: 1, destaque: v.destaque, mostrar_preco: 1, descricao_catalogo: v.texto, renave_status: 'nao_aplicavel', ...v.fipe,
        });
        for (let i = 1; i <= 4; i++) {
            const arquivo = `demo-${id}-${i}.jpg`;
            copyFileSync(join(raiz, 'demo', `${v.fotos}-${i}.jpg`), join(pastaFotos, arquivo));
            b.inserir('veiculo_fotos', { veiculo_id: id, arquivo, ordem: i - 1 });
        }
    }
}
// Executado pela linha de comando (npm run demo)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const pastaDados = process.env.PASTA_DADOS ?? join(raiz, 'data');
    const pastaFotos = join(pastaDados, 'fotos');
    const b = new Banco(join(pastaDados, 'erp.db'));
    if (process.argv.includes('remover')) {
        console.log(`${removerDemo(b, pastaFotos)} veículo(s) de demonstração removido(s).`);
    }
    else {
        semearDemo(b, pastaFotos);
        console.log('3 veículos de demonstração publicados no catálogo. Abra http://localhost:3000/ para ver.');
        console.log('Para remover: npm run demo -- remover');
    }
    b.fechar();
}
