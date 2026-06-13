declare namespace NodeJS {
    interface ProcessEnv {
        MIYAPAD_PORT?: string;
        MIYAPAD_HOST?: string;
        MIYAPAD_LOGIN?: string;
        MIYAPAD_PASSWORD?: string;
        MIYAPAD_STORAGE_PATH?: string;
        MIYAPAD_NO_OPEN?: string;
        MIYAPAD_NO_BACKUP?: string;
        MIYAPAD_BACKUP_INTERVAL?: string;
        MIYAPAD_BACKUP_DIR?: string;
        MIYAPAD_BACKUP_KEEP?: string;
    }
}
