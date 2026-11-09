export interface ToastDetail { message: string; undo?: () => Promise<void> | void; tone?: 'ok' | 'bad' }
export const showToast = (d: ToastDetail) => window.dispatchEvent(new CustomEvent<ToastDetail>('app-toast', { detail: d }));
