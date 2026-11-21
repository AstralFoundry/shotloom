/**
 * Host contract the workbench needs from the canvas it is embedded in.
 *
 * The world engine never imports the host application's canvas model; it receives
 * only the fields it actually reads. Keep this file the single copy of that shape.
 */

export type CanvasNodePosition = { x: number; y: number };

/** Canvas image node the workbench can turn into a billboard or a 360° panorama. */
export type CanvasNodeData = {
    id: string;
    title: string;
    metadata?: {
        /** Inline image source (data URL / object URL / http URL). */
        content?: string;
        /** Host storage key; resolved through the `resolveImageUrl` host port. */
        storageKey?: string;
        contentUrl?: string;
        /** Shot this node previews inside the scene. */
        previsShotId?: string;
        /** Canvas image node holding the last rendered preview frame. */
        previsPreviewNodeId?: string;
        /** Display title set by the host workflow (overrides the node title). */
        workflowTitle?: string;
    };
};
