export type StandaloneStartupOptions = {
    initializeDatabase: () => void | Promise<void>;
    prepare?: () => void | Promise<void>;
    startServer: () => Promise<void>;
    startKdsServer: () => Promise<void>;
    startServerApp?: () => Promise<void>;
    isShutdownRequested: () => boolean;
};
export declare function startStandaloneServers({ initializeDatabase, prepare, startServer, startKdsServer, startServerApp, isShutdownRequested, }: StandaloneStartupOptions): Promise<void>;
//# sourceMappingURL=standalone-startup.d.ts.map