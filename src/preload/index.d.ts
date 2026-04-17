declare const api: {
    readonly platform: NodeJS.Platform;
    readonly invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    readonly on: (channel: string, listener: (...args: unknown[]) => void) => (() => void);
};
export type PreloadApi = typeof api;
export {};
