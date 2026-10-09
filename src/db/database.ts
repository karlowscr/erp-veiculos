import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRACOES, MIGRACOES_PG } from './schema.js';
import { ESQUEMA_PG, FUNCOES_PG, VERSAO_BASE_PG } from './schema-pg.js';
import { MotorPg, traduzirSql } from './postgres.js';

type SQLInputValue = null | number | bigint | string | Uint8Array;
export type Linha = Record<string, any>;
export type Params = SQLInputValue[] | Record<string, SQLInputValue>;

export const ehUrlPostgres = (s: string | undefined) => !!s && /^postgres(ql)?:\/\//i.test(s);

/**
 * Camada única de acesso ao banco. Todo o resto do sistema usa só
 * `one`, `all`, `run`, `tx`, `inserir` e `atualizar`.
 *
 * Funciona com dois motores:
 *  - SQLite (arquivo local) — instalação na própria máquina da loja;
 *  - PostgreSQL (Supabase) — quando recebe uma URL postgres://.
 */
export class Banco {
  readonly db?: DatabaseSync;
  private pg?: MotorPg;
  readonly motor: 'sqlite' | 'postgres';
  /** Colunas numéricas de cada tabela (PostgreSQL não aceita '' em número, o SQLite aceitava). */
  private numericas = new Map<string, Set<string>>();
  private comId = new Set<string>();

  constructor(arquivo: string) {
    if (ehUrlPostgres(arquivo)) {
      this.motor = 'postgres';
      this.pg = new MotorPg(arquivo);
      this.migrarPg();
      this.lerEstruturaPg();
      return;
    }
    this.motor = 'sqlite';
    if (arquivo !== ':memory:') mkdirSync(dirname(arquivo), { recursive: true });
    this.db = new DatabaseSync(arquivo);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrar();
  }

  private migrar(): void {
    const db = this.db!;
    db.exec('CREATE TABLE IF NOT EXISTS _migracoes (versao INTEGER PRIMARY KEY, aplicada_em TEXT NOT NULL)');
    const atual = (db.prepare('SELECT COALESCE(MAX(versao), 0) AS v FROM _migracoes').get() as Linha).v as number;
    if (atual >= MIGRACOES.length) return;
    // Chaves estrangeiras desligadas durante a migração para permitir recriar tabelas
    // (procedimento recomendado pelo SQLite); conferidas ao final.
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      MIGRACOES.forEach((sql, i) => {
        const versao = i + 1;
        if (versao <= atual) return;
        this.tx(() => {
          db.exec(sql);
          const quebradas = db.prepare('PRAGMA foreign_key_check').all();
          if (quebradas.length) throw new Error(`Migração ${versao} deixou referências inválidas.`);
          db.prepare("INSERT INTO _migracoes (versao, aplicada_em) VALUES (?, datetime('now'))").run(versao);
        });
      });
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }

  /**
   * PostgreSQL: o banco novo recebe o esquema completo de uma vez
   * (equivalente a todas as migrações do SQLite até VERSAO_BASE_PG);
   * migrações posteriores vêm de MIGRACOES_PG.
   */
  private migrarPg(): void {
    const pg = this.pg!;
    pg.consultar('CREATE TABLE IF NOT EXISTS _migracoes (versao BIGINT PRIMARY KEY, aplicada_em TEXT NOT NULL)');
    // Trava para duas instâncias (Vercel) não migrarem ao mesmo tempo
    pg.consultar('BEGIN');
    try {
      pg.consultar('SELECT pg_advisory_xact_lock(726354)');
      const atual = Number(pg.consultar('SELECT COALESCE(MAX(versao), 0) AS v FROM _migracoes').linhas[0].v);
      pg.consultar(FUNCOES_PG);
      if (atual === 0) {
        pg.consultar(ESQUEMA_PG);
        for (let v = 1; v <= VERSAO_BASE_PG; v++) {
          pg.consultar("INSERT INTO _migracoes (versao, aplicada_em) VALUES ($1, sl_datetime('now'))", [v]);
        }
      }
      const desde = Math.max(atual, VERSAO_BASE_PG);
      for (let v = desde + 1; v <= MIGRACOES.length; v++) {
        const sql = MIGRACOES_PG[v];
        if (!sql) throw new Error(`A migração ${v} não tem versão para PostgreSQL (MIGRACOES_PG em schema.ts).`);
        pg.consultar(sql);
        pg.consultar("INSERT INTO _migracoes (versao, aplicada_em) VALUES ($1, sl_datetime('now'))", [v]);
      }
      // O Supabase publica as tabelas do esquema public na API REST (chave anônima).
      // O sistema não usa essa API: RLS ligado e sem políticas = ninguém acessa por ela.
      pg.consultar(`DO $p$ DECLARE t record; BEGIN
        FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() LOOP
          EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.tablename);
        END LOOP;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM anon, authenticated', current_schema());
          EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM anon, authenticated', current_schema());
        END IF;
      END $p$`);
      pg.consultar('COMMIT');
    } catch (e) {
      pg.consultar('ROLLBACK');
      throw e;
    }
  }

  private lerEstruturaPg(): void {
    const cols = this.pg!.consultar(
      `SELECT table_name AS t, column_name AS c, data_type AS tipo FROM information_schema.columns
       WHERE table_schema = current_schema()`,
    ).linhas;
    for (const { t, c, tipo } of cols) {
      if (c === 'id') this.comId.add(t);
      if (/int|double|numeric|real/.test(tipo)) {
        if (!this.numericas.has(t)) this.numericas.set(t, new Set());
        this.numericas.get(t)!.add(c);
      }
    }
  }

  private consultaPg(sql: string, params: Params) {
    if (!Array.isArray(params)) throw new Error('Parâmetros nomeados não são suportados no PostgreSQL.');
    return this.pg!.consultar(traduzirSql(sql), params.map(normalizarPg));
  }

  one<T = Linha>(sql: string, params: Params = []): T | undefined {
    if (this.pg) return this.consultaPg(sql, params).linhas[0] as T | undefined;
    const st = this.db!.prepare(sql);
    return (Array.isArray(params) ? st.get(...(params as any[])) : st.get(params as any)) as T | undefined;
  }

  all<T = Linha>(sql: string, params: Params = []): T[] {
    if (this.pg) return this.consultaPg(sql, params).linhas as T[];
    const st = this.db!.prepare(sql);
    return (Array.isArray(params) ? st.all(...(params as any[])) : st.all(params as any)) as T[];
  }

  run(sql: string, params: Params = []): { id: number; alteradas: number } {
    if (this.pg) {
      let texto = sql;
      const ins = /^\s*INSERT\s+INTO\s+"?(\w+)"?/i.exec(sql);
      const devolveId = !!ins && this.comId.has(ins[1]) && !/\bRETURNING\b/i.test(sql);
      if (devolveId) texto = sql.replace(/;\s*$/, '') + ' RETURNING id';
      const r = this.consultaPg(texto, params);
      return { id: devolveId ? Number(r.linhas[0]?.id ?? 0) : 0, alteradas: r.alteradas };
    }
    const st = this.db!.prepare(sql);
    const r = Array.isArray(params) ? st.run(...(params as any[])) : st.run(params as any);
    return { id: Number(r.lastInsertRowid), alteradas: Number(r.changes) };
  }

  /** Executa vários comandos sem parâmetros (scripts, testes). */
  exec(sql: string): void {
    if (this.pg) this.pg.consultar(traduzirSql(sql));
    else this.db!.exec(sql);
  }

  /** Executa `fn` numa transação; desfaz tudo se lançar erro. Aceita aninhamento. */
  private profundidade = 0;
  tx<T>(fn: () => T): T {
    const ponto = `sp${this.profundidade}`;
    const executar = (s: string) => (this.pg ? this.pg.consultar(s) : this.db!.exec(s));
    executar(this.profundidade === 0 ? (this.pg ? 'BEGIN' : 'BEGIN IMMEDIATE') : `SAVEPOINT ${ponto}`);
    this.profundidade++;
    try {
      const r = fn();
      if (r instanceof Promise) throw new Error('tx() não aceita funções assíncronas.');
      this.profundidade--;
      executar(this.profundidade === 0 ? 'COMMIT' : `RELEASE ${ponto}`);
      return r;
    } catch (e) {
      this.profundidade--;
      if (this.profundidade === 0) executar('ROLLBACK');
      else {
        executar(`ROLLBACK TO ${ponto}`);
        executar(`RELEASE ${ponto}`);
      }
      throw e;
    }
  }

  /** Insere um objeto; ignora chaves com valor `undefined`. */
  inserir(tabela: string, dados: Linha): number {
    const cols = Object.keys(dados).filter((k) => dados[k] !== undefined);
    const sql = `INSERT INTO ${tabela} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
    const id = this.run(sql, cols.map((c) => this.valorColuna(tabela, c, dados[c]))).id;
    // id informado à mão: a sequência do PostgreSQL precisa avançar junto
    if (this.pg && cols.includes('id') && this.comId.has(tabela)) {
      this.pg.consultar(`SELECT setval(pg_get_serial_sequence('${tabela}', 'id'), (SELECT MAX(id) FROM ${tabela}))`);
    }
    return id;
  }

  atualizar(tabela: string, id: number, dados: Linha): void {
    const cols = Object.keys(dados).filter((k) => dados[k] !== undefined);
    if (!cols.length) return;
    const sql = `UPDATE ${tabela} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
    this.run(sql, [...cols.map((c) => this.valorColuna(tabela, c, dados[c])), id]);
  }

  private valorColuna(tabela: string, coluna: string, v: unknown): SQLInputValue {
    const n = normalizar(v);
    if (this.pg && this.numericas.get(tabela)?.has(coluna) && typeof n === 'string') {
      const t = n.trim();
      if (t === '') return null;
      const num = Number(t);
      return Number.isFinite(num) ? num : n;
    }
    return n;
  }

  fechar(): void {
    if (this.pg) this.pg.fechar();
    else this.db!.close();
  }
}

function normalizar(v: unknown): SQLInputValue {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === undefined) return null;
  return v as SQLInputValue;
}

function normalizarPg(v: unknown): unknown {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === undefined) return null;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array && !Buffer.isBuffer(v)) return Buffer.from(v);
  return v;
}
