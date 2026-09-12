import { WebSocketServer } from 'ws';
export declare const KDS_AUTH_TIMEOUT_MS = 5000;
export declare const MAX_KDS_CLIENTS = 100;
export declare const MAX_UNAUTHENTICATED_KDS_CLIENTS = 25;
export declare function setupKdsWebSocket(wss: WebSocketServer): void;
export declare function notifyKdsUpdate(): void;
export declare function notifyOrderUpdated(): void;
//# sourceMappingURL=kds.d.ts.map