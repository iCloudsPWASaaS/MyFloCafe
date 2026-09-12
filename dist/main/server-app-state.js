"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDefaultServerAppPort = getDefaultServerAppPort;
exports.getServerAppPort = getServerAppPort;
exports.setServerAppPort = setServerAppPort;
const DEFAULT_SERVER_APP_PORT = parseInt(process.env.SERVER_APP_PORT || '3003', 10);
let activeServerAppPort = DEFAULT_SERVER_APP_PORT;
function getDefaultServerAppPort() {
    return DEFAULT_SERVER_APP_PORT;
}
function getServerAppPort() {
    return activeServerAppPort;
}
function setServerAppPort(port) {
    activeServerAppPort = port;
}
//# sourceMappingURL=server-app-state.js.map