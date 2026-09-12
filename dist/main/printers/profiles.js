"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_PRINTER_PROFILES = void 0;
exports.getSupportedPrinterProfiles = getSupportedPrinterProfiles;
exports.matchSupportedPrinterProfile = matchSupportedPrinterProfile;
exports.resolvePrinterProfile = resolvePrinterProfile;
exports.getPrinterCapabilities = getPrinterCapabilities;
const thermal_capabilities_1 = require("../../shared/print/thermal-capabilities");
exports.SUPPORTED_PRINTER_PROFILES = [
    {
        id: 'xprinter-xp-v320m-v330m',
        make: 'Xprinter',
        model: 'XP-V320M / XP-V330M',
        aliases: ['xprinter xp-v320m', 'xprinter xp-v330m', 'xp-v320m', 'xp-v330m', 'v320m', 'v330m'],
        commandSet: 'escpos',
        defaultPaperWidth: 'cols-42',
        defaultPort: 9100,
        fontAColumns: 42,
        fontBColumns: 64,
        printWidthMm: 72,
        cutMode: 'partial',
        capabilities: thermal_capabilities_1.GENERIC_THERMAL_CAPABILITIES,
        notes: '80mm ESC/POS receipt printer. Vendor specs list 72mm print width, 576 dots/line, Font A 42/48 columns, Font B 56/64 columns.',
    },
    {
        id: 'epson-tm-series',
        make: 'Epson',
        model: 'TM Series ESC/POS',
        aliases: ['epson tm', 'tm-t88', 'tm-t82', 'tm-t20', 'tm-m30'],
        commandSet: 'escpos',
        defaultPaperWidth: 'cols-48',
        defaultPort: 9100,
        fontAColumns: 48,
        fontBColumns: 64,
        cutMode: 'partial',
        capabilities: thermal_capabilities_1.GENERIC_THERMAL_CAPABILITIES,
    },
    {
        id: 'generic-escpos-80',
        make: 'Generic',
        model: 'ESC/POS 80mm',
        aliases: ['generic 80mm', '80mm thermal', 'thermal 80'],
        commandSet: 'escpos',
        defaultPaperWidth: 'cols-42',
        defaultPort: 9100,
        fontAColumns: 42,
        fontBColumns: 64,
        cutMode: 'full',
        capabilities: {
            ...thermal_capabilities_1.GENERIC_THERMAL_CAPABILITIES,
            encoding: { codePages: ['ascii'], preferredCodePage: 'ascii' },
        },
    },
    {
        id: 'generic-escpos-58',
        make: 'Generic',
        model: 'ESC/POS 58mm',
        aliases: ['generic 58mm', '58mm thermal', 'thermal 58'],
        commandSet: 'escpos',
        defaultPaperWidth: 'cols-32',
        defaultPort: 9100,
        fontAColumns: 32,
        fontBColumns: 56,
        cutMode: 'full',
        capabilities: {
            ...thermal_capabilities_1.GENERIC_THERMAL_CAPABILITIES,
            encoding: { codePages: ['ascii'], preferredCodePage: 'ascii' },
        },
    },
];
function getSupportedPrinterProfiles() {
    return exports.SUPPORTED_PRINTER_PROFILES;
}
function matchSupportedPrinterProfile(...parts) {
    const haystack = parts
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .replace(/[_]+/g, '-');
    if (!haystack)
        return null;
    for (const profile of exports.SUPPORTED_PRINTER_PROFILES) {
        const tokens = [`${profile.make} ${profile.model}`, profile.model, ...profile.aliases].map((s) => s.toLowerCase());
        if (tokens.some((token) => haystack.includes(token)))
            return profile;
    }
    return null;
}
function resolvePrinterProfile(printer) {
    const explicit = printer?.profile_id || printer?.profileId;
    if (explicit) {
        const profile = exports.SUPPORTED_PRINTER_PROFILES.find((p) => p.id === explicit);
        if (profile)
            return profile;
    }
    const matched = matchSupportedPrinterProfile(printer?.name, printer?.make, printer?.model);
    if (matched)
        return matched;
    const paperWidth = printer?.paper_width || printer?.paperWidth;
    return String(paperWidth || '').startsWith('58mm')
        ? exports.SUPPORTED_PRINTER_PROFILES.find((p) => p.id === 'generic-escpos-58')
        : exports.SUPPORTED_PRINTER_PROFILES.find((p) => p.id === 'generic-escpos-80');
}
function getPrinterCapabilities(profile, arabicShapingOverride) {
    return (0, thermal_capabilities_1.mergeThermalCapabilities)(profile.capabilities || thermal_capabilities_1.GENERIC_THERMAL_CAPABILITIES, arabicShapingOverride);
}
//# sourceMappingURL=profiles.js.map