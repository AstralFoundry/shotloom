import { DirectorCommandError } from './errors.ts';

/** A revision is local to one loaded iframe session, never a persistent document version. */
export class DirectorHostSession {
    private instanceId: string | null = null;
    private token = crypto.randomUUID();
    connected = false;
    private versions = new Map<number, { entities: Map<string, string>; sections: Map<string, string> }>();

    record(revision: number, document: Record<string, unknown>): void {
        const entities = new Map<string, string>();
        const sections = new Map<string, string>();
        const scenes = document.scenes as Array<{ id: string; state: Record<string, unknown> }>;
        for (const scene of scenes ?? []) {
            sections.set(`${scene.id}.metadata`, JSON.stringify(Object.fromEntries(Object.entries(scene).filter(([key]) => key !== 'state'))));
            for (const entity of (scene.state.entities ?? []) as Array<{ id: string }>) entities.set(entity.id, (entities.get(entity.id) ?? '') + JSON.stringify([scene.id, entity]));
            for (const [key, value] of Object.entries(scene.state)) if (key !== 'entities') sections.set(`${scene.id}.${key}`, JSON.stringify(value));
        }
        for (const [key, value] of Object.entries(document)) if (key !== 'scenes') sections.set(key, JSON.stringify(value));
        this.versions.set(revision, { entities, sections });
        if (this.versions.size > 32) this.versions.delete(this.versions.keys().next().value!);
    }

    diff(fromRevision: number, toRevision: number) {
        const before = this.versions.get(fromRevision), after = this.versions.get(toRevision);
        if (!before || !after) return { fromRevision, toRevision, complete: false, reason: '版本记录已过期或属于其他会话，请重读快照' };
        return { fromRevision, toRevision, complete: true,
            addedEntityIds: [...after.entities.keys()].filter(id => !before.entities.has(id)),
            deletedEntityIds: [...before.entities.keys()].filter(id => !after.entities.has(id)),
            modifiedEntityIds: [...after.entities.keys()].filter(id => before.entities.has(id) && before.entities.get(id) !== after.entities.get(id)),
            changedSections: [...new Set([...before.sections.keys(), ...after.sections.keys()])].filter(key => before.sections.get(key) !== after.sections.get(key)),
        };
    }

    get id() { return this.token; }

    /** ready and iframe load both deliver initialization; only the first may load the document. */
    initialize(instanceId: string, load: () => void): boolean {
        if (this.connected && this.instanceId === instanceId) return false;
        this.connected = false;
        this.instanceId = null;
        this.token = crypto.randomUUID();
        this.versions.clear();
        load();
        this.instanceId = instanceId;
        this.connected = true;
        return true;
    }

    assertCurrent(expectedSessionId: unknown, currentRevision: number): void {
        if (expectedSessionId === this.token) return;
        throw new DirectorCommandError('导演台运行会话已变化或未提供会话标识，本批次未写入', {
            code: 'SESSION_MISMATCH',
            hint: '重新读取 director_desk_snapshot，核对当前场景后使用其中的 sessionId 和 revision 提交。revision 是会话内计数，重新打开会从头计数，不表示场景内容丢失；不要只替换版本号重放旧批次。',
            facts: { currentSessionId: this.token, currentRevision },
        });
    }
}
