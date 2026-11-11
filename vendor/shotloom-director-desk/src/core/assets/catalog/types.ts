import type { Action, Entity } from '../../model.ts';
import type { JointLabels } from '../joint-schema.ts';
export interface AssetParameter {
    label: string;
    default: number;
    min: number;
    max: number;
    step: number;
    unit?: string;
    integer?: boolean;
    choices?: Readonly<Record<string, string>>;
}

export interface AssetDefinition {
    id: string;
    name: string;
    kind: 'actor' | 'prop' | 'crowd';
    group: string;
    icon: string;
    aliases?: readonly string[];
    /** Hide editable variants from the default library while keeping them searchable and loadable. */
    libraryHidden?: boolean;
    /** Keep existing scenes loadable, but remove this asset from browsing and search. */
    libraryRetired?: boolean;
    family?: string;
    defaults?: Partial<Pick<Entity, 'height' | 'gender' | 'build' | 'light' | 'color'>>;
    capabilities?: {
        rig: 'human-legacy' | 'human' | 'quadruped' | 'bird' | 'fish' | 'serpent' | 'none';
        actions: readonly Action[];
        pose: boolean;
        path: boolean;
    };
    joints?: JointLabels;
    parameters?: Readonly<Record<string, AssetParameter>>;
}
