module.exports = function meshtasticCompatLoader(source) {
    const original = 'array.buffer instanceof SharedArrayBuffer';
    if (!source.includes(original)) {
        throw new Error('Meshtastic compatibility patch no longer matches the installed library; review the loader before upgrading.');
    }
    const configure = 'await this.configure().catch((error) => {\n          this.log.warn(';
    if (!source.includes(configure)) {
        throw new Error('Meshtastic HTTP configuration patch no longer matches the installed library; review the loader before upgrading.');
    }
    return source
        .replace(original, '(typeof SharedArrayBuffer !== "undefined" && array.buffer instanceof SharedArrayBuffer)')
        .replace(configure, 'this.configure().catch((error) => {\n          this.log.warn(');
};
