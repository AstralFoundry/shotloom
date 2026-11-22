import { useState } from 'react';
import { Button, Switch, Upload } from 'antd';
import { t } from '@/i18n';
import { AgentPetPoster, useAgentPets } from './AgentPet';
import { AGENT_PET_ZIP_LIMIT, AgentPetArchiveError, readAgentPetArchive } from '../../services/agentPetArchive';
import { addAgentPets, removeAgentPet, selectAgentPet, setAgentPetVisible } from '../../services/agentPetLibrary';
import { confirmAction } from '../ui/confirm/confirmService';

const errors = { invalid: 'agentPet.invalid', tooLarge: 'agentPet.tooLarge', duplicate: 'agentPet.duplicate' } as const;

export function AgentPetSettings() {
  const { pets, selected, visible, error } = useAgentPets();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setFeedback('');
    try { await action(); }
    catch (cause) { setFeedback(t(cause instanceof AgentPetArchiveError ? errors[cause.reason] : 'agentPet.storageError')); }
    finally { setBusy(false); }
  }

  return <section className="settings-section">
    <h4>{t('agentPet.heading')}</h4>
    <div className="settings-row settings-toggle-row">
      <div><strong>{t('agentPet.show')}</strong><span>{t('agentPet.showHint')}</span></div>
      <Switch aria-label={t('agentPet.show')} checked={visible} disabled={busy} onChange={value => void run(() => setAgentPetVisible(value))} />
    </div>
    <div className="agent-pet-settings-grid" role="group" aria-label={t('agentPet.heading')}>
      {pets.map(pet => <div className="agent-pet-setting" key={pet.id}>
        <button type="button" className="agent-pet-choice" aria-pressed={selected === pet.id} disabled={busy}
          onClick={() => void run(() => selectAgentPet(pet.id))}>
          <AgentPetPoster pet={pet} />
          <span>{pet.name}</span>
        </button>
        {pet.imported && <Button size="small" type="text" disabled={busy} onClick={() => void run(async () => {
          if (await confirmAction({ title: t('agentPet.removeMessage', { name: pet.name }), danger: true })) await removeAgentPet(pet.id);
        })}>{t('agentPet.remove')}</Button>}
      </div>)}
    </div>
    <div className="settings-row">
      <div><strong>{t('agentPet.import')}</strong><span>{t('agentPet.importHint')}</span></div>
      <Upload accept=".zip,application/zip" disabled={busy} showUploadList={false} beforeUpload={file => {
        void run(async () => {
          if (file.size > AGENT_PET_ZIP_LIMIT) throw new AgentPetArchiveError('tooLarge');
          await addAgentPets(readAgentPetArchive(new Uint8Array(await file.arrayBuffer())));
        });
        return Upload.LIST_IGNORE;
      }}>
        <Button disabled={busy}>{t('agentPet.chooseZip')}</Button>
      </Upload>
    </div>
    {(feedback || error) && <p role="alert" className="agent-pet-error">{feedback || t('agentPet.storageError')}</p>}
  </section>;
}
