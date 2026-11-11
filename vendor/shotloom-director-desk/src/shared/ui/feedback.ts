/**
 * Bridge between non-React code (editor session, engine callbacks) and antd feedback widgets.
 * The shell binds the antd `message` instance once; everything else calls the free functions.
 */
export interface NoticeApi {
    success(content: string): void;
    error(content: string): void;
    info(content: string): void;
}

let api: NoticeApi | null = null;

export function bindNotices(instance: NoticeApi): () => void {
    api = instance;
    return () => {
        if (api === instance) api = null;
    };
}

export function notify(message: string): void {
    api?.info(message);
}

export function notifyError(message: string): void {
    if (api) api.error(message);
    else console.error(message);
}

export function notifySuccess(message: string): void {
    api?.success(message);
}
