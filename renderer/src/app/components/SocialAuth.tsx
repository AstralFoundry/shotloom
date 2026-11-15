import { useState } from 'react';
import { cloudOrigin } from '../../services/cloudRequest';
import { t } from '../../i18n';

// Supabase UI Social Auth, adapted to the BFF and Shotloom's controls.
// https://supabase.com/ui/r/social-auth-react.json
export function SocialAuth({ recover = false }: { recover?: boolean }) {
  const [busy, setBusy] = useState(false);
  return <form action={`${cloudOrigin}/api/auth/login`} method="get" target={recover ? '_blank' : '_self'}
    onSubmit={() => { if (!recover) setBusy(true); }}>
    <input type="hidden" name="redirect" value={window.location.href} />
    <button className="button primary" type="submit" disabled={busy}>
      {busy ? t('cloud.login.loading') : t('cloud.login.action')}
    </button>
  </form>;
}
