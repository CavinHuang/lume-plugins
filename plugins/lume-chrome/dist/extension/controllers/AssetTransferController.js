function toBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk)
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(binary);
}
export class AssetTransferController {
    native;
    constructor(native) {
        this.native = native;
    }
    async writeBytes(name, bytes, mimeType = "application/octet-stream") {
        const created = await this.native.requestHost("host.asset.create", { name, mimeType, size: bytes.byteLength });
        const chunkSize = 256 * 1024;
        try {
            for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                await this.native.requestHost("host.asset.append", { assetId: created.assetId, offset, dataBase64: toBase64(bytes.subarray(offset, offset + chunkSize)) });
            }
            return await this.native.requestHost("host.asset.finish", { assetId: created.assetId });
        }
        catch (error) {
            await this.native.requestHost("host.asset.abort", { assetId: created.assetId }).catch(() => undefined);
            throw error;
        }
    }
    writeText(name, text, mimeType = "text/plain;charset=utf-8") {
        return this.writeBytes(name, new TextEncoder().encode(text), mimeType);
    }
    remove(assetId) { return this.native.requestHost("host.asset.remove", { assetId }); }
}
