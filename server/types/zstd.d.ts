export interface ZstdConfigRow {
    id: number;
    config: string;
}

declare module 'sqlite3' {
    interface Database {
        run(sql: string, params?: any[], callback?: (this: import('sqlite3').RunResult, err: Error | null) => void): this;
    }
}
