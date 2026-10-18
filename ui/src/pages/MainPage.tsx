import type { PluginInfo } from '../api/plugin.ts'
import { t } from '../i18n/index.ts'

interface MainPageProps {
  info: PluginInfo | null
  lifecycle: 'active' | 'inactive'
  error: string
  onOpenDetails: () => void
}

export function MainPage({ info, lifecycle, error, onOpenDetails }: MainPageProps) {
  return (
    <main className="panel" data-surface-state={lifecycle}>
      <section className="example-panel plugin-panel">
      <h2>{t('app.connection')}</h2>
      <dl>
        <dt>{t('view.pluginId')}</dt><dd>{info?.id ?? t('status.loading')}</dd>
        <dt>{t('app.version')}</dt><dd>{info?.version ?? '—'}</dd>
        <dt>{t('view.surface')}</dt><dd>{t(lifecycle === 'active' ? 'status.active' : 'status.inactive')}</dd>
      </dl>
      {error && <p role="alert" className="error">{t('app.backendError', { error })}</p>}
      <button type="button" className="app-button" data-variant="primary" onClick={onOpenDetails}>
        {t('app.openView')}
      </button>
      </section>
    </main>
  )
}
