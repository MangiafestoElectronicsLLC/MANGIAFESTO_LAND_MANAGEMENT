export const parseMockGpsPath = (rawValue: string) => {
    const tokens = rawValue
        .split(/\r?\n|[;,]/)
        .map(token => token.trim())
        .filter(Boolean);

    const points: Array<{ lat: number; lng: number }> = [];

    for (let index = 0; index + 1 < tokens.length; index += 2) {
        const lat = Number(tokens[index]);
        const lng = Number(tokens[index + 1]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            points.push({ lat, lng });
        }
    }

    return points;
};
