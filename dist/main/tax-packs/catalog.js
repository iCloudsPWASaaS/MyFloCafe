"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeTaxPackUpdates = computeTaxPackUpdates;
exports.taxPackSha256 = taxPackSha256;
exports.parseTaxPackCatalog = parseTaxPackCatalog;
exports.fetchRemoteTaxPackCatalog = fetchRemoteTaxPackCatalog;
exports.verifyTaxPackSignature = verifyTaxPackSignature;
exports.downloadAndVerifyTaxPack = downloadAndVerifyTaxPack;
const crypto_1 = require("crypto");
const trusted_signing_key_1 = require("./trusted-signing-key");
const template_labels_1 = require("../print/template-labels");
const RELEASES_API_URL = 'https://api.github.com/repos/FreeOpenSourcePOS/FloCafe-Plugins/releases';
const RELEASE_DOWNLOAD_PATH_PREFIX = '/FreeOpenSourcePOS/FloCafe-Plugins/releases/download/';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RELEASE_PAGES = 10;
const MAX_CATALOG_BYTES = 1_000_000;
const MAX_PACK_BYTES = 2_000_000;
const MAX_SIGNATURE_BYTES = 4_096;
// Pack ids renamed by commit 3a75876, before the public catalog existed —
// see LEGACY_TRUSTED_PACK_DIGESTS in routes/tax-packs.ts for the matching
// signature-trust concern. Stores that installed one of these before the
// rename still carry the pre-rename id in country_packs.id; the catalog only
// lists the current id, so update checks must resolve through this alias or
// a renamed pack looks like "no updates" forever.
const LEGACY_TAX_PACK_ID_ALIASES = {
    'official-in': 'official-india',
    'official-th': 'official-thailand',
};
function currentTaxPackId(packId) {
    return LEGACY_TAX_PACK_ID_ALIASES[packId] || packId;
}
function newerVersion(a, b) {
    return a.localeCompare(b, undefined, { numeric: true }) > 0;
}
function computeTaxPackUpdates(installed, catalog) {
    const updates = [];
    for (const row of installed) {
        const catalogId = currentTaxPackId(row.packId);
        const newest = catalog.packs
            .filter((entry) => entry.id === catalogId)
            .reduce((best, entry) => (!best || newerVersion(entry.version, best.version) ? entry : best), null);
        if (newest && newerVersion(newest.version, row.version)) {
            updates.push({
                packId: catalogId,
                installedPackId: row.packId,
                country: row.country,
                publisher: row.publisher,
                currentVersion: row.version,
                latestVersion: newest.version,
                entry: newest,
            });
        }
    }
    return updates;
}
function taxPackSha256(value) {
    return (0, crypto_1.createHash)('sha256').update(value, 'utf8').digest('hex');
}
function trustedReleaseDownloadUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && url.hostname === 'github.com'
            && !url.username
            && !url.password
            && url.pathname.startsWith(RELEASE_DOWNLOAD_PATH_PREFIX);
    }
    catch {
        return false;
    }
}
function validCatalogEntry(value) {
    if (!value || typeof value !== 'object')
        return false;
    const entry = value;
    return typeof entry.id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(entry.id)
        && typeof entry.publisher === 'string' && entry.publisher.length > 0
        && typeof entry.country === 'string' && /^([A-Z]{2}|\*)$/.test(entry.country)
        && typeof entry.jurisdiction === 'string' && entry.jurisdiction.length > 0
        && typeof entry.version === 'string' && /^\d+\.\d+\.\d+$/.test(entry.version)
        && typeof entry.publishedAt === 'string' && Number.isFinite(Date.parse(entry.publishedAt))
        && typeof entry.minFloVersion === 'string' && /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(entry.minFloVersion)
        && typeof entry.digest === 'string' && /^[a-f0-9]{64}$/.test(entry.digest)
        && typeof entry.downloadUrl === 'string' && trustedReleaseDownloadUrl(entry.downloadUrl)
        && typeof entry.signatureUrl === 'string' && trustedReleaseDownloadUrl(entry.signatureUrl);
}
function parseTaxPackCatalog(value) {
    if (!value || typeof value !== 'object')
        throw new Error('Tax pack catalog is not an object');
    const catalog = value;
    if (catalog.schemaVersion !== 1)
        throw new Error('Unsupported tax pack catalog schema');
    if (typeof catalog.generatedAt !== 'string' || !Number.isFinite(Date.parse(catalog.generatedAt))) {
        throw new Error('Tax pack catalog generatedAt is invalid');
    }
    if (!Array.isArray(catalog.packs) || !catalog.packs.every(validCatalogEntry)) {
        throw new Error('Tax pack catalog contains an invalid entry');
    }
    const identities = catalog.packs.map((entry) => `${entry.id}@${entry.version}`);
    if (new Set(identities).size !== identities.length) {
        throw new Error('Tax pack catalog contains duplicate pack versions');
    }
    return catalog;
}
async function fetchText(url, maxBytes, fetchImpl, headers, signal) {
    const response = await fetchImpl(url, {
        headers: {
            'User-Agent': 'FloCafe-Tax-Pack-Manager',
            Accept: 'application/json',
            ...headers,
        },
        redirect: 'follow',
        signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
            : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok)
        throw new Error(`Download failed with HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > maxBytes)
        throw new Error('Downloaded artifact exceeds the size limit');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes)
        throw new Error('Downloaded artifact exceeds the size limit');
    return bytes.toString('utf8');
}
async function fetchRemoteTaxPackCatalog(fetchImpl = fetch, signal) {
    for (let page = 1; page <= MAX_RELEASE_PAGES; page += 1) {
        const releasesJson = await fetchText(`${RELEASES_API_URL}?per_page=100&page=${page}`, MAX_CATALOG_BYTES, fetchImpl, { Accept: 'application/vnd.github+json' }, signal);
        let releases;
        try {
            releases = JSON.parse(releasesJson);
        }
        catch {
            throw new Error('GitHub Releases returned invalid JSON');
        }
        if (!Array.isArray(releases))
            throw new Error('GitHub Releases response is invalid');
        for (const release of releases) {
            if (release.draft === true
                || typeof release.tag_name !== 'string'
                || !/^tax-pack-[a-z0-9][a-z0-9-]*-v\d+\.\d+\.\d+$/.test(release.tag_name)
                || !Array.isArray(release.assets)) {
                continue;
            }
            const catalogAsset = release.assets.find((asset) => asset.name === 'catalog.json' && typeof asset.browser_download_url === 'string');
            if (!catalogAsset || typeof catalogAsset.browser_download_url !== 'string'
                || !trustedReleaseDownloadUrl(catalogAsset.browser_download_url)) {
                continue;
            }
            const catalogJson = await fetchText(catalogAsset.browser_download_url, MAX_CATALOG_BYTES, fetchImpl, undefined, signal);
            let parsed;
            try {
                parsed = JSON.parse(catalogJson);
            }
            catch {
                throw new Error('Tax pack catalog JSON is invalid');
            }
            return {
                releaseTag: release.tag_name,
                releaseUrl: typeof release.html_url === 'string' ? release.html_url : '',
                catalog: parseTaxPackCatalog(parsed),
            };
        }
        if (releases.length < 100)
            break;
    }
    throw new Error('No published tax pack catalog is available');
}
function decodeSignature(value) {
    const normalized = value.trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
        throw new Error('Tax pack signature is not valid base64');
    }
    const signature = Buffer.from(normalized, 'base64');
    if (signature.length !== 64)
        throw new Error('Tax pack signature has an invalid length');
    return signature;
}
function validPluginPrintTemplate(value) {
    if (!value || typeof value !== 'object')
        return false;
    const template = value;
    const renderer = template.renderer;
    const payload = Object.prototype.hasOwnProperty.call(template, 'templatePayload')
        ? template.templatePayload
        : template.payload;
    const paperColumns = Array.isArray(template.paperColumns) ? template.paperColumns : [];
    const hasPaperColumns = paperColumns.length > 0
        && paperColumns.every((width) => Number.isInteger(width) && [32, 36, 40, 42, 44, 48].includes(width));
    const payloadObject = payload && typeof payload === 'object' ? payload : {};
    // Additive optional `labels` map (#445): validated fail-closed at install
    // time. A malformed map throws with a clear rejection message instead of
    // failing silently; templates without labels behave exactly as before.
    (0, template_labels_1.validateTemplateLabelsMap)(payloadObject.labels);
    // Charge rows are an additive v1 capability declaration. Validate only when
    // present so older signed templates retain their existing contract.
    if (payloadObject.format === 'escpos-line-template-v1') {
        const totals = payloadObject.totals && typeof payloadObject.totals === 'object' && !Array.isArray(payloadObject.totals)
            ? payloadObject.totals
            : {};
        (0, template_labels_1.validateTemplateChargeRows)(totals.chargeRows);
    }
    const payloadProfiles = Array.isArray(payloadObject.widthProfiles) ? payloadObject.widthProfiles : [];
    const hasMatchingProfiles = payloadObject.format === 'escpos-line-template-v1'
        && payloadProfiles.length > 0
        && paperColumns.every((width) => payloadProfiles.some((profile) => {
            if (!profile || typeof profile !== 'object')
                return false;
            return profile.columns === width;
        }));
    return typeof template.id === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(template.id)
        && typeof template.displayName === 'string' && template.displayName.trim().length > 0
        && typeof template.country === 'string' && /^([A-Z]{2}|\*)$/.test(template.country)
        && typeof template.jurisdiction === 'string' && template.jurisdiction.length > 0
        && hasPaperColumns
        && hasMatchingProfiles
        && !!renderer
        && typeof renderer.id === 'string'
        && typeof renderer.version === 'number'
        && Number.isInteger(renderer.version)
        && renderer.version > 0
        && payload !== undefined;
}
function normalizePluginPrintTemplate(template) {
    return {
        ...template,
        paperColumns: [...new Set(template.paperColumns)].sort((a, b) => a - b),
        templatePayload: template.templatePayload ?? template.payload,
    };
}
function parseSignedArtifact(rawJson) {
    let parsed;
    try {
        parsed = JSON.parse(rawJson);
    }
    catch {
        throw new Error('Tax pack JSON is invalid');
    }
    if (!parsed || typeof parsed !== 'object')
        throw new Error('Tax pack JSON is invalid');
    const candidate = parsed;
    if (candidate.artifactType === 'country-tax-pack-plugin') {
        const artifact = candidate;
        if (artifact.schemaVersion !== 1 || !artifact.taxPack || typeof artifact.taxPack !== 'object') {
            throw new Error('Tax pack plugin artifact is invalid');
        }
        const printTemplates = artifact.printTemplates || [];
        if (!Array.isArray(printTemplates) || !printTemplates.every(validPluginPrintTemplate)) {
            throw new Error('Tax pack plugin artifact contains an invalid print template');
        }
        return {
            pack: artifact.taxPack,
            packJson: JSON.stringify(artifact.taxPack),
            printTemplates: printTemplates.map(normalizePluginPrintTemplate),
        };
    }
    return {
        pack: parsed,
        packJson: rawJson,
        printTemplates: [],
    };
}
function verifyTaxPackSignature(packJson, signature, publicKey = trusted_signing_key_1.TRUSTED_TAX_PACK_SIGNING_PUBLIC_KEY) {
    try {
        // Ed25519 selects its signing algorithm from the key, so Node requires a
        // null digest algorithm here rather than a separate hash name.
        return (0, crypto_1.verify)(null, Buffer.from(packJson, 'utf8'), publicKey, decodeSignature(signature));
    }
    catch {
        return false;
    }
}
async function downloadAndVerifyTaxPack(entry, fetchImpl = fetch, publicKey = trusted_signing_key_1.TRUSTED_TAX_PACK_SIGNING_PUBLIC_KEY, signal) {
    if (!validCatalogEntry(entry))
        throw new Error('Tax pack catalog entry is invalid');
    const [packJson, signature] = await Promise.all([
        fetchText(entry.downloadUrl, MAX_PACK_BYTES, fetchImpl, undefined, signal),
        fetchText(entry.signatureUrl, MAX_SIGNATURE_BYTES, fetchImpl, { Accept: 'text/plain' }, signal),
    ]);
    if (taxPackSha256(packJson) !== entry.digest) {
        throw new Error('Tax pack digest does not match the catalog');
    }
    if (!verifyTaxPackSignature(packJson, signature, publicKey)) {
        throw new Error('Tax pack signature verification failed');
    }
    const artifact = parseSignedArtifact(packJson);
    const pack = artifact.pack;
    if (pack.id !== entry.id
        || pack.version !== entry.version
        || pack.publisher !== entry.publisher
        || pack.country !== entry.country
        || pack.jurisdiction !== entry.jurisdiction
        || pack.publishedAt !== entry.publishedAt
        || pack.minFloVersion !== entry.minFloVersion) {
        throw new Error('Tax pack identity does not match the signed catalog entry');
    }
    if (pack.publisher === 'local') {
        throw new Error('Local tax packs cannot be installed from the public catalog');
    }
    return {
        entry,
        pack,
        packJson: artifact.packJson,
        artifactJson: packJson,
        signature: signature.trim(),
        printTemplates: artifact.printTemplates,
    };
}
//# sourceMappingURL=catalog.js.map