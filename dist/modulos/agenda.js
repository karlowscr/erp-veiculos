import { falhar } from '../util/comum.js';
export const AGENDA_PADRAO = {
    dias: [
        { aberto: false, inicio: '08:00', fim: '12:00' },
        ...[1, 2, 3, 4, 5].map(() => ({ aberto: true, inicio: '08:00', fim: '18:00' })),
        { aberto: true, inicio: '08:00', fim: '12:00' },
    ],
    intervalo: 60,
    capacidade: 1,
    fechados: [],
};
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutos = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** Confere e normaliza a configuração vinda do formulário. */
export function validarAgenda(entrada) {
    let c = entrada;
    if (typeof c === 'string') {
        try {
            c = JSON.parse(c || '{}');
        }
        catch {
            falhar('Configuração de horários inválida.');
        }
    }
    if (!c || typeof c !== 'object')
        return AGENDA_PADRAO;
    const dias = Array.isArray(c.dias) && c.dias.length === 7 ? c.dias : AGENDA_PADRAO.dias;
    const nomes = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    return {
        dias: dias.map((d, i) => {
            const aberto = !!d?.aberto;
            const inicio = HORA.test(d?.inicio) ? d.inicio : AGENDA_PADRAO.dias[i].inicio;
            const fim = HORA.test(d?.fim) ? d.fim : AGENDA_PADRAO.dias[i].fim;
            if (aberto && minutos(fim) <= minutos(inicio))
                falhar(`Na ${nomes[i]}, o horário final precisa ser depois do inicial.`);
            return { aberto, inicio, fim };
        }),
        intervalo: [30, 60, 90, 120].includes(Number(c.intervalo)) ? Number(c.intervalo) : 60,
        capacidade: Math.min(10, Math.max(1, Math.round(Number(c.capacidade) || 1))),
        fechados: (Array.isArray(c.fechados) ? c.fechados : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d))).slice(0, 120).sort(),
    };
}
export function lerAgenda(e) {
    try {
        return e.agenda ? validarAgenda(e.agenda) : AGENDA_PADRAO;
    }
    catch {
        return AGENDA_PADRAO;
    }
}
/** Agora no horário de Fortaleza (UTC-3, sem horário de verão), como "AAAA-MM-DD" e minutos do dia. */
function agoraLocal(agora = Date.now()) {
    const d = new Date(agora - 3 * 3600_000);
    return { data: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes(), d };
}
/** Quantas visitas já foram pedidas em cada "dia hora". */
function ocupados(b) {
    const mapa = new Map();
    for (const c of b.all("SELECT dados FROM contatos_site WHERE tipo = 'visita' AND criado_em > datetime('now', '-60 days')")) {
        try {
            const d = JSON.parse(c.dados || '{}');
            if (d.v_dia && d.v_hora)
                mapa.set(`${d.v_dia} ${d.v_hora}`, (mapa.get(`${d.v_dia} ${d.v_hora}`) ?? 0) + 1);
        }
        catch { /* pedido antigo sem horário */ }
    }
    return mapa;
}
/** Próximos dias com os horários (o de hoje só a partir de 1 hora depois de agora). */
export function agendaProximosDias(b, e, quantos = 21, agora = Date.now()) {
    const cfg = lerAgenda(e);
    const cheio = ocupados(b);
    const hoje = agoraLocal(agora);
    const fechados = new Set(cfg.fechados);
    const dias = [];
    for (let i = 0; i < quantos; i++) {
        const d = new Date(hoje.d.getTime() + i * 86400_000);
        const data = d.toISOString().slice(0, 10);
        const semana = d.getUTCDay();
        const conf = cfg.dias[semana];
        const horarios = [];
        if (conf.aberto && !fechados.has(data)) {
            for (let m = minutos(conf.inicio); m < minutos(conf.fim); m += cfg.intervalo) {
                if (i === 0 && m < hoje.min + 60)
                    continue;
                const hora = hhmm(m);
                horarios.push({ hora, livre: (cheio.get(`${data} ${hora}`) ?? 0) < cfg.capacidade });
            }
        }
        const fechado = !conf.aberto || fechados.has(data);
        dias.push({ data, semana, aberto: horarios.some((h) => h.livre), fechado, horarios });
    }
    return dias;
}
/** O horário pedido existe na agenda e ainda tem vaga? */
export function horarioDisponivel(b, e, dia, hora) {
    return agendaProximosDias(b, e, 60).some((d) => d.data === dia && d.horarios.some((h) => h.hora === hora && h.livre));
}
