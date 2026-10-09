import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MIGRACOES } from './schema.js';

type SQLInputValue = null | number | bigint | string | Uint8Array;
export type Linha = Record<string, any>;
export type Params = SQLInputValue[] | Record<string, SQLInputValue>;

/**
 * Camada única de acesso ao banco. Todo o resto do sistema usa só
 * `one`, `all`, `run` e `tx`. Para migrar para PostgreSQL no futuro,
 * basta reimplementar esta classe.
 */
export class Banco {
  readonly db: DatabaseSync;

  constructor(arquivo: string) {
    if (arquivo !== ':memory:') mkdirSync(dirname(arquivo), { recursive: true });
    this.db = new DatabaseSync(arquivo);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrar();
  }

  private migrar(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS _migracoes (versao INTEGER PRIMARY KEY, aplicada_em TEXT NOT NULL)');
    const atual = (this.db.prepare('SELECT COALESCE(MAX(versao), 0) AS v FROM _migracoes').get() as Linha).v as number;
    if (atual >= MIGRACOES.length) return;
    // Chaves estrangeiras desligadas durante a migração para permitir recriar tabelas
    // (procedimento recomendado pelo SQLite); conferidas ao final.
    this.db.exec('PRAGMA foreign_keys = OFF');
    try {
      MIGRACOES.forEach((sql, i) => {
        const versao = i + 1;
        if (versao <= atual) return;
        this.tx(() => {
          this.db.exec(sql);
          const quebradas = this.db.prepare('PRAGMA foreign_key_check').all();
          if (quebradas.length) throw new Error(`Migração ${versao} deixou referências inválidas.`);
          this.db.prepare("INSERT INTO _migracoes (versao, aplicada_em) VALUES (?, datetime('now'))").run(versao);
        });
      });
    } finally {
      this.db.exec('PRAGMA foreign_keys = ON');
    }
  }

  one<T = Linha>(sql: string, params: Params = []): T | undefined {
    const st = this.db.prepare(sql);
    return (Array.isArray(params) ? st.get(...(params as any[])) : st.get(params as any)) as T | undefined;
  }

  all<T = Linha>(sql: string, params: Params = []): T[] {
    const st = this.db.prepare(sql);
    return (Array.isArray(params) ? st.all(...(params as any[])) : st.all(params as any)) as T[];
  }

  run(sql: string, params: Params = []): { id: number; alteradas: number } {
    const st = this.db.prepare(sql);
    const r = Array.isArray(params) ? st.run(...(params as any[])) : st.run(params as any);
    return { id: Number(r.lastInsertRowid), alteradas: Number(r.changes) };
  }

  /** Executa `fn` numa transação; desfaz tudo se lançar erro. Aceita aninhamento. */
  private profundidade = 0;
  tx<T>(fn: () => T): T {
    const ponto = `sp${this.profundidade}`;
    this.db.exec(this.profundidade === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${ponto}`);
    this.profundidade++;
    try {
      const r = fn();
      this.profundidade--;
      this.db.exec(this.profundidade === 0 ? 'COMMIT' : `RELEASE ${ponto}`);
      return r;
    } catch (e) {
      this.profundidade--;
      this.db.exec(this.profundidade === 0 ? 'ROLLBACK' : `ROLLBACK TO ${ponto}; RELEASE ${ponto}`);
      throw e;
    }
  }

  /** Insere um objeto; ignora chaves com valor `undefined`. */
  inserir(tabela: string, dados: Linha): number {
    const cols = Object.keys(dados).filter((k) => dados[k] !== undefined);
    const sql = `INSERT INTO ${tabela} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
    return this.run(sql, cols.map((c) => normalizar(dados[c]))).id;
  }

  atualizar(tabela: string, id: number, dados: Linha): void {
    const cols = Object.keys(dados).filter((k) => dados[k] !== undefined);
    if (!cols.length) return;
    const sql = `UPDATE ${tabela} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
    this.run(sql, [...cols.map((c) => normalizar(dados[c])), id]);
  }

  fechar(): void {
    this.db.close();
  }
}

function normalizar(v: unknown): SQLInputValue {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === undefined) return null;
  return v as SQLInputValue;
}
