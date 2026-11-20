/**
 * Diagnostics host port.
 *
 * The world engine records structured failures through the host's diagnostic buffer instead
 * of keeping a parallel log. Until a host installs a sink, events are dropped.
 */
export type PrevisDiagnosticInput = {
    level: "debug" | "info" | "warn" | "error";
    category: string;
    code: string;
    message: string;
};

export type PrevisDiagnosticSink = (input: PrevisDiagnosticInput) => void;

let sink: PrevisDiagnosticSink | null = null;

export function setPrevisDiagnosticSink(next: PrevisDiagnosticSink | null) {
    sink = next;
}

export function recordDiagnosticEvent(input: PrevisDiagnosticInput) {
    sink?.(input);
}

/** Installed by the host console bridge so the engine can report through it. */
export function installPrevisDiagnosticSink(next: PrevisDiagnosticSink) {
    const previous = sink;
    setPrevisDiagnosticSink(next);
    return () => setPrevisDiagnosticSink(previous);
}

export function previsDiagnosticSinkInstalled() {
    return sink !== null;
}
