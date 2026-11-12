/**
 * Deterministic comparison between a rendered frame and a reference image.
 *
 * "布局和参考图差距有点大" is the kind of feedback a rendered frame does not answer by itself: the
 * agent can look at both pictures but cannot say *which* region drifted, and every re-derivation of
 * the layout produced a slightly different set of coordinates, so the whole set got rebuilt again.
 * These four numbers name the drift — how much of the silhouette overlaps, whether the proportions
 * differ, whether the colours are in the same family, and which of 16 cells is wrong.
 *
 * They are evidence, not a verdict. Silhouette and histogram metrics are blind to material,
 * depth and lighting, and a plane view and a perspective shot of the same set score badly against
 * each other on purpose. Visual judgement stays the authority; this only says where to look.
 */

/** RGBA pixels in the shape `CanvasRenderingContext2D.getImageData` returns. */
export interface Pixels {
    width: number;
    height: number;
    data: ArrayLike<number>;
}

export interface ForegroundMask {
    /** Row-major `height × width` grid of foreground booleans. */
    cells: Uint8Array;
    width: number;
    height: number;
    /** Bounds in mask pixels, or null when nothing but background was found. */
    box: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

export interface ImageComparison {
    /** Overlap of the two silhouettes, 0–1, after each is cropped to its own bounds. */
    silhouetteIou: number;
    /** Foreground box aspect ratios (width ÷ height) and how far apart they are, relatively. */
    aspect: { render: number; reference: number; difference: number };
    /** Cosine similarity of 4×4×4 RGB histograms of foreground pixels, 0–1. */
    colorSimilarity: number;
    /** Signed silhouette coverage difference per cell, row-major, top-left first. */
    gridDiff: number[];
    /** Cells where coverage differs most, 1-based `row,column`, worst first. */
    worstCells: { row: number; column: number; difference: number }[];
    /** Plain-language band; `strong` still does not mean the picture is right. */
    verdict: 'strong' | 'moderate' | 'weak';
    /** Foreground share of each image, useful when one side is nearly empty. */
    coverage: { render: number; reference: number };
}

const ANALYSIS = 128;
/** Euclidean RGB distance from the estimated background that counts as foreground. */
const BACKGROUND_DELTA = 42;
const GRID = 4;
const HISTOGRAM_BINS = 4;

/** Median colour of the border pixels — the studio backdrop, in both renders and most references. */
function borderColor(image: Pixels, sample: number): [number, number, number] {
    const { width, height, data } = image;
    const at = (x: number, y: number) => {
        const index = (y * width + x) * 4;
        return [data[index], data[index + 1], data[index + 2]] as [number, number, number];
    };
    const samples: [number, number, number][] = [];
    const stepX = Math.max(1, Math.floor(width / sample));
    const stepY = Math.max(1, Math.floor(height / sample));
    for (let x = 0; x < width; x += stepX) {
        samples.push(at(x, 0), at(x, height - 1));
    }
    for (let y = 0; y < height; y += stepY) {
        samples.push(at(0, y), at(width - 1, y));
    }
    const median = (channel: 0 | 1 | 2) => {
        const values = samples.map((colour) => colour[channel]).sort((a, b) => a - b);
        return values[Math.floor(values.length / 2)] ?? 0;
    };
    return [median(0), median(1), median(2)];
}

/** Nearest-neighbour downsample: cheap, and it keeps the border pixels the background estimate uses. */
function downsample(image: Pixels, size: number): Pixels {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y += 1) {
        const sourceY = Math.min(image.height - 1, Math.floor((y * image.height) / size));
        for (let x = 0; x < size; x += 1) {
            const sourceX = Math.min(image.width - 1, Math.floor((x * image.width) / size));
            const from = (sourceY * image.width + sourceX) * 4;
            const to = (y * size + x) * 4;
            data[to] = image.data[from];
            data[to + 1] = image.data[from + 1];
            data[to + 2] = image.data[from + 2];
            data[to + 3] = image.data[from + 3];
        }
    }
    return { width: size, height: size, data };
}

/** Foreground mask by colour distance from the estimated background. */
export function foregroundMask(image: Pixels, size = ANALYSIS): ForegroundMask {
    const small = downstream(image, size);
    const background = borderColor(small, 64);
    const cells = new Uint8Array(size * size);
    let minX = size, minY = size, maxX = -1, maxY = -1;
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const index = (y * size + x) * 4;
            const dr = small.data[index] - background[0];
            const dg = small.data[index + 1] - background[1];
            const db = small.data[index + 2] - background[2];
            if (Math.sqrt(dr * dr + dg * dg + db * db) <= BACKGROUND_DELTA) continue;
            cells[y * size + x] = 1;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
    }
    return {
        cells, width: size, height: size,
        box: maxX < 0 ? null : { minX, minY, maxX, maxY },
    };
}

function downstream(image: Pixels, size: number) {
    return image.width === size && image.height === size ? image : downsample(image, size);
}

/**
 * Resample each mask's bounding box into a common square, keeping its aspect ratio.
 *
 * Stretching the box to fill the square would erase shape differences — a 4:1 bar and a square
 * would land on the same pixels and score a perfect overlap. Fitting the box inside the square
 * keeps the proportion, so silhouette IoU answers "is it the same shape"; where the shape sits is
 * a different question, answered by `gridDiff` on the untouched masks.
 */
function normalized(mask: ForegroundMask, size: number): Uint8Array {
    const out = new Uint8Array(size * size);
    if (!mask.box) return out;
    const { minX, minY, maxX, maxY } = mask.box;
    const boxWidth = maxX - minX + 1, boxHeight = maxY - minY + 1;
    const scale = Math.min(size / boxWidth, size / boxHeight);
    const drawWidth = Math.max(1, Math.round(boxWidth * scale));
    const drawHeight = Math.max(1, Math.round(boxHeight * scale));
    const offsetX = Math.floor((size - drawWidth) / 2);
    const offsetY = Math.floor((size - drawHeight) / 2);
    for (let y = 0; y < drawHeight; y += 1) {
        const sourceY = minY + Math.min(boxHeight - 1, Math.floor(((y + 0.5) * boxHeight) / drawHeight));
        for (let x = 0; x < drawWidth; x += 1) {
            const sourceX = minX + Math.min(boxWidth - 1, Math.floor(((x + 0.5) * boxWidth) / drawWidth));
            out[(offsetY + y) * size + offsetX + x] = mask.cells[sourceY * mask.width + sourceX];
        }
    }
    return out;
}

function coverage(mask: ForegroundMask): number {
    let count = 0;
    for (const cell of mask.cells) count += cell;
    return count / (mask.width * mask.height);
}

function aspectRatio(mask: ForegroundMask): number {
    if (!mask.box) return 1;
    return (mask.box.maxX - mask.box.minX + 1) / (mask.box.maxY - mask.box.minY + 1);
}

/** 4×4×4 RGB histogram of foreground pixels. */
function histogram(image: Pixels, mask: ForegroundMask): Float64Array {
    const bins = new Float64Array(HISTOGRAM_BINS ** 3);
    const small = downstream(image, mask.width);
    for (let y = 0; y < mask.height; y += 1) {
        for (let x = 0; x < mask.width; x += 1) {
            if (!mask.cells[y * mask.width + x]) continue;
            const index = (y * mask.width + x) * 4;
            const r = Math.min(HISTOGRAM_BINS - 1, Math.floor((small.data[index] / 256) * HISTOGRAM_BINS));
            const g = Math.min(HISTOGRAM_BINS - 1, Math.floor((small.data[index + 1] / 256) * HISTOGRAM_BINS));
            const b = Math.min(HISTOGRAM_BINS - 1, Math.floor((small.data[index + 2] / 256) * HISTOGRAM_BINS));
            bins[(r * HISTOGRAM_BINS + g) * HISTOGRAM_BINS + b] += 1;
        }
    }
    return bins;
}

function cosine(a: Float64Array, b: Float64Array): number {
    let dot = 0, normA = 0, normB = 0;
    for (let index = 0; index < a.length; index += 1) {
        dot += a[index] * b[index];
        normA += a[index] * a[index];
        normB += b[index] * b[index];
    }
    if (!normA || !normB) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Compare a rendered image with a reference.
 *
 * Compare like with like: a plan view against a top-down reference, a shot frame against a still
 * from that shot. A plan view against a camera frame scores low no matter how faithful the build is.
 */
export function compareImages(render: Pixels, reference: Pixels): ImageComparison {
    const renderMask = foregroundMask(render);
    const referenceMask = foregroundMask(reference);
    const renderCells = normalized(renderMask, ANALYSIS);
    const referenceCells = normalized(referenceMask, ANALYSIS);

    let intersection = 0, union = 0;
    for (let index = 0; index < renderCells.length; index += 1) {
        const a = renderCells[index], b = referenceCells[index];
        if (a && b) intersection += 1;
        if (a || b) union += 1;
    }
    const silhouetteIou = union ? intersection / union : 0;

    const renderAspect = aspectRatio(renderMask);
    const referenceAspect = aspectRatio(referenceMask);
    const colorSimilarity = cosine(histogram(render, renderMask), histogram(reference, referenceMask));

    // Per-cell coverage on the raw masks (not the normalized ones): the grid is meant to point at
    // "the lower-left of the set", so it has to keep each image's own framing.
    const gridDiff: number[] = [];
    const cellCoverage = (mask: ForegroundMask, row: number, column: number) => {
        const x0 = Math.floor((column * mask.width) / GRID), x1 = Math.floor(((column + 1) * mask.width) / GRID);
        const y0 = Math.floor((row * mask.height) / GRID), y1 = Math.floor(((row + 1) * mask.height) / GRID);
        let count = 0, total = 0;
        for (let y = y0; y < y1; y += 1) {
            for (let x = x0; x < x1; x += 1) {
                total += 1;
                count += mask.cells[y * mask.width + x];
            }
        }
        return total ? count / total : 0;
    };
    const worstCells: ImageComparison['worstCells'] = [];
    for (let row = 0; row < GRID; row += 1) {
        for (let column = 0; column < GRID; column += 1) {
            const difference = cellCoverage(renderMask, row, column) - cellCoverage(referenceMask, row, column);
            gridDiff.push(Number(difference.toFixed(3)));
            worstCells.push({ row: row + 1, column: column + 1, difference: Number(Math.abs(difference).toFixed(3)) });
        }
    }
    worstCells.sort((a, b) => b.difference - a.difference);

    const difference = referenceAspect ? Math.abs(renderAspect - referenceAspect) / referenceAspect : 1;
    const score = silhouetteIou * 0.6 + Math.max(0, 1 - difference) * 0.2 + colorSimilarity * 0.2;
    const verdict = score >= 0.78 ? 'strong' : score >= 0.5 ? 'moderate' : 'weak';

    return {
        silhouetteIou: Number(silhouetteIou.toFixed(3)),
        aspect: {
            render: Number(renderAspect.toFixed(3)),
            reference: Number(referenceAspect.toFixed(3)),
            difference: Number(difference.toFixed(3)),
        },
        colorSimilarity: Number(colorSimilarity.toFixed(3)),
        gridDiff,
        worstCells: worstCells.slice(0, 4),
        verdict,
        coverage: { render: Number(coverage(renderMask).toFixed(3)), reference: Number(coverage(referenceMask).toFixed(3)) },
    };
}
