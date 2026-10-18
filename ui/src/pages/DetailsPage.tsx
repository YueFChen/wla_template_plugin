import type { PluginInfo } from '../api/plugin.ts'
import { t } from '../i18n/index.ts'

interface DetailsPageProps {
  info: PluginInfo | null
  lifecycle: 'active' | 'inactive'
}

export function DetailsPage({ info, lifecycle }: DetailsPageProps) {
  return (
    <main className="panel">
      <section className="example-panel plugin-panel">
      <h2>{t('view.summary')}</h2>
      <dl>
        <dt>{t('view.pluginId')}</dt><dd>{info?.id ?? t('status.loading')}</dd>
        <dt>{t('view.surface')}</dt><dd>{t(lifecycle === 'active' ? 'status.active' : 'status.inactive')}</dd>
      </dl>
      </section>
    </main>
  )
}
